import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIRES, compileTurn, isScenarioBearing, startMock } from '../mock-model.mjs';

const MOCK = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'mock-model.mjs');
const ENDPOINTS = { 'anthropic-messages': '/v1/messages', 'openai-chat': '/v1/chat/completions' };
const SCENARIO = {
  id: 'demo',
  model: 'mock-model',
  turns: [
    { toolCalls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { text: 'finished' },
  ],
};

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-mock-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withTempSync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hk-mock-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'close' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function readTrace(path) {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function firstPort(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline !== -1) resolve(JSON.parse(buffer.slice(0, newline)).port);
    });
    stream.on('error', reject);
  });
}

for (const dialect of WIRES) {
  test(`${dialect}: non-streaming scenario turn returns the scripted tool call`, async () => {
    await withTemp(async (dir) => {
      const trace = join(dir, 'trace.jsonl');
      const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect, port: 0 });
      try {
        const res = await post(port, ENDPOINTS[dialect], { model: 'mock-model', tools: [{ type: 'function', name: 'read_file' }], stream: false });
        assert.equal(res.status, 200);
        const body = JSON.parse(res.text);
        if (dialect === 'anthropic-messages') {
          assert.equal(body.stop_reason, 'tool_use');
          assert.equal(body.content[0].type, 'tool_use');
          assert.equal(body.content[0].name, 'read_file');
          assert.deepEqual(body.content[0].input, { path: 'a.txt' });
        } else {
          assert.equal(body.choices[0].finish_reason, 'tool_calls');
          assert.equal(body.choices[0].message.tool_calls[0].function.name, 'read_file');
          assert.deepEqual(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments), { path: 'a.txt' });
        }
      } finally {
        await close();
      }
    });
  });

  test(`${dialect}: streaming scenario turn emits dialect-correct SSE`, async () => {
    await withTemp(async (dir) => {
      const trace = join(dir, 'trace.jsonl');
      const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect, port: 0 });
      try {
        const res = await post(port, ENDPOINTS[dialect], { model: 'mock-model', tools: [{ type: 'function', name: 'read_file' }], stream: true });
        assert.equal(res.status, 200);
        if (dialect === 'anthropic-messages') {
          for (const event of ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']) {
            assert.match(res.text, new RegExp(`event: ${event}\\n`));
          }
          assert.ok(res.text.indexOf('event: message_start') < res.text.indexOf('event: message_stop'));
        } else {
          assert.match(res.text, /^data: \{/m);
          assert.ok(res.text.endsWith('data: [DONE]\n\n'));
        }
      } finally {
        await close();
      }
    });
  });
}

test('a non-scenario request is skipped and does not consume a turn', async () => {
  await withTemp(async (dir) => {
    const trace = join(dir, 'trace.jsonl');
    const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect: 'openai-chat', port: 0 });
    try {
      const skipped = await post(port, ENDPOINTS['openai-chat'], { model: 'mock-model', stream: false });
      assert.equal(JSON.parse(skipped.text).choices[0].finish_reason, 'stop');
      const scenario = await post(port, ENDPOINTS['openai-chat'], { model: 'mock-model', tools: [{ type: 'function', name: 'read_file' }], stream: false });
      assert.equal(JSON.parse(scenario.text).choices[0].finish_reason, 'tool_calls', 'the skipped call must not have consumed turn 0');
      const lines = readTrace(trace);
      assert.equal(lines[0].classified, 'skipped');
      assert.equal(lines[0].turn, null);
      assert.equal(lines[1].classified, 'scenario');
      assert.equal(lines[1].turn, 0);
    } finally {
      await close();
    }
  });
});

test('a tool-result follow-up advances exactly one turn', async () => {
  await withTemp(async (dir) => {
    const trace = join(dir, 'trace.jsonl');
    const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect: 'anthropic-messages', port: 0 });
    try {
      const tools = [{ name: 'read_file', input_schema: {} }];
      const first = await post(port, ENDPOINTS['anthropic-messages'], { model: 'mock-model', tools, stream: false });
      assert.equal(JSON.parse(first.text).stop_reason, 'tool_use');
      const followUp = await post(port, ENDPOINTS['anthropic-messages'], { model: 'mock-model', tools, stream: false, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] }] });
      const followUpBody = JSON.parse(followUp.text);
      assert.equal(followUpBody.stop_reason, 'end_turn');
      assert.equal(followUpBody.content[0].text, 'finished');
      const lines = readTrace(trace);
      assert.equal(lines[0].turn, 0);
      assert.equal(lines[1].turn, 1);
    } finally {
      await close();
    }
  });
});

test('requests after the final turn keep returning the final turn', async () => {
  await withTemp(async (dir) => {
    const trace = join(dir, 'trace.jsonl');
    const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect: 'openai-chat', port: 0 });
    try {
      const tools = [{ type: 'function', name: 'read_file' }];
      await post(port, ENDPOINTS['openai-chat'], { model: 'mock-model', tools, stream: false });
      const second = await post(port, ENDPOINTS['openai-chat'], { model: 'mock-model', tools, stream: false });
      const third = await post(port, ENDPOINTS['openai-chat'], { model: 'mock-model', tools, stream: false });
      assert.equal(JSON.parse(second.text).choices[0].message.content, 'finished');
      assert.equal(JSON.parse(third.text).choices[0].message.content, 'finished');
      const lines = readTrace(trace);
      assert.equal(lines[1].turn, 1);
      assert.equal(lines[2].turn, 1);
    } finally {
      await close();
    }
  });
});

test('malformed scenarios are rejected before serving', async () => {
  await assert.rejects(startMock({ scenario: { id: 'x', model: 'm' }, tracePath: 'x', dialect: 'openai-chat', port: 0 }), /turns/);
  await assert.rejects(startMock({ scenario: { id: 'x', model: 'm', turns: [{ toolCalls: [{ name: 'a', arguments: {} }], text: 'both' }] }, tracePath: 'x', dialect: 'openai-chat', port: 0 }), /both toolCalls and text/);
  await assert.rejects(startMock({ scenario: SCENARIO, tracePath: 'x', dialect: 'gemini', port: 0 }), /unknown dialect/);
});

test('the trace records one complete line per request', async () => {
  await withTemp(async (dir) => {
    const trace = join(dir, 'trace.jsonl');
    const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect: 'anthropic-messages', port: 0 });
    try {
      await post(port, ENDPOINTS['anthropic-messages'], { model: 'mock-model', tools: [{ name: 'read_file', input_schema: {} }], stream: false });
      const [line] = readTrace(trace);
      assert.deepEqual(Object.keys(line).sort(), ['classified', 'dialect', 'model', 'path', 'stopReason', 't', 'toolCalls', 'turn']);
      assert.equal(line.path, '/v1/messages');
      assert.equal(line.dialect, 'anthropic-messages');
      assert.equal(line.model, 'mock-model');
      assert.equal(line.classified, 'scenario');
      assert.equal(line.turn, 0);
      assert.deepEqual(line.toolCalls, ['read_file']);
      assert.equal(line.stopReason, 'tool_use');
      assert.ok(!Number.isNaN(Date.parse(line.t)));
    } finally {
      await close();
    }
  });
});

test('unknown paths return 404 with a JSON body', async () => {
  await withTemp(async (dir) => {
    const trace = join(dir, 'trace.jsonl');
    const { port, close } = await startMock({ scenario: SCENARIO, tracePath: trace, dialect: 'openai-chat', port: 0 });
    try {
      const res = await post(port, '/v1/messages', { model: 'mock-model' });
      assert.equal(res.status, 404);
      assert.equal(JSON.parse(res.text).error.type, 'not_found');
    } finally {
      await close();
    }
  });
});

test('isScenarioBearing classifies by tools schema per dialect', () => {
  assert.equal(isScenarioBearing({ tools: [{ name: 'x' }] }, 'anthropic-messages'), true);
  assert.equal(isScenarioBearing({ tools: [] }, 'anthropic-messages'), false);
  assert.equal(isScenarioBearing({}, 'anthropic-messages'), false);
  assert.equal(isScenarioBearing({ tools: [{ type: 'function', name: 'x' }] }, 'openai-chat'), true);
  assert.equal(isScenarioBearing({ tools: [{ type: 'web_search' }] }, 'openai-chat'), false);
  assert.equal(isScenarioBearing({}, 'openai-chat'), false);
  assert.throws(() => isScenarioBearing({}, 'gemini'), /unknown dialect/);
});

test('compileTurn is deterministic and dialect-shaped', () => {
  const turn = { toolCalls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] };
  const first = compileTurn(turn, 'anthropic-messages', 'mock-model');
  const second = compileTurn(turn, 'anthropic-messages', 'mock-model');
  assert.deepEqual(first, second);
  assert.equal(first.stopReason, 'tool_use');
  assert.deepEqual(first.toolCalls, ['read_file']);
  const openai = compileTurn(turn, 'openai-chat', 'mock-model');
  assert.equal(openai.stopReason, 'tool_calls');
  assert.equal(openai.body.choices[0].message.tool_calls[0].function.name, 'read_file');
});

test('CLI --self-test exits 0 with an empty stdout', () => {
  const out = execFileSync('node', [MOCK, '--self-test'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(out, '');
});

test('CLI rejects a malformed scenario with a non-zero exit and a stderr reason', () => {
  withTempSync((dir) => {
    const scenarioPath = join(dir, 'bad.json');
    writeFileSync(scenarioPath, JSON.stringify({ id: 'x', model: 'm', turns: [{ toolCalls: [{ name: 'a', arguments: {} }], text: 'both' }] }));
    assert.throws(
      () => execFileSync('node', [MOCK, '--port', '0', '--scenario', scenarioPath, '--trace', join(dir, 't.jsonl'), '--dialect', 'openai-chat'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      (error) => {
        assert.match(error.stderr, /both toolCalls and text/);
        return true;
      },
    );
  });
});

test('CLI prints exactly one port line and serves', async () => {
  await withTemp(async (dir) => {
    const scenarioPath = join(dir, 'scenario.json');
    writeFileSync(scenarioPath, JSON.stringify(SCENARIO));
    const trace = join(dir, 'trace.jsonl');
    const child = spawn('node', [MOCK, '--port', '0', '--scenario', scenarioPath, '--trace', trace, '--dialect', 'openai-chat'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const port = await firstPort(child.stdout);
      assert.equal(typeof port, 'number');
      assert.ok(port > 0);
      const res = await post(port, ENDPOINTS['openai-chat'], { model: 'mock-model', tools: [{ type: 'function', name: 'read_file' }], stream: false });
      assert.equal(res.status, 200);
    } finally {
      child.kill();
      await new Promise((done) => {
        if (child.exitCode !== null) { done(); return; }
        child.once('exit', done);
      });
    }
  });
});
