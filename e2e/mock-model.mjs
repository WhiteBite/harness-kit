/** Deterministic mock LLM endpoint: replays compiled scenario turns over a wire dialect and records a JSONL trace. */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIRES = Object.freeze(['anthropic-messages', 'openai-chat']);

const ENDPOINTS = {
  'anthropic-messages': '/v1/messages',
  'openai-chat': '/v1/chat/completions',
};

function digest(seed) {
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

function normalizeToolCalls(turn, prefix) {
  if (!Array.isArray(turn.toolCalls)) return [];
  return turn.toolCalls.map((call, index) => ({
    id: `${prefix}${digest(`${call.name}:${JSON.stringify(call.arguments)}:${index}`)}`,
    name: call.name,
    arguments: call.arguments,
  }));
}

// Anthropic requires this exact event order: message_start, per-block start/delta/stop, message_delta, message_stop.
function anthropicEvents(id, model, content, stopReason) {
  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } } },
  ];
  content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } });
      events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } } });
    } else {
      events.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } } });
      events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } } });
    }
    events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
  });
  events.push({ event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } } });
  events.push({ event: 'message_stop', data: { type: 'message_stop' } });
  return events;
}

function openAiEvents(id, model, text, toolCalls, finishReason) {
  const base = { id, object: 'chat.completion.chunk', created: 0, model };
  const delta = { role: 'assistant' };
  if (text !== null) delta.content = text;
  if (toolCalls.length > 0) {
    delta.tool_calls = toolCalls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
  }
  return [
    { event: null, data: { ...base, choices: [{ index: 0, delta, finish_reason: null }] } },
    { event: null, data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] } },
  ];
}

function compileAnthropicTurn(turn, model) {
  const toolCalls = normalizeToolCalls(turn, 'toolu_');
  const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
  const id = `msg_${digest(`${model}:${turn.text ?? ''}:${toolCalls.map((call) => call.name).join(',')}`)}`;
  const content = [];
  if (typeof turn.text === 'string') content.push({ type: 'text', text: turn.text });
  for (const call of toolCalls) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
  const body = { id, type: 'message', role: 'assistant', model, content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  return { stopReason, toolCalls: toolCalls.map((call) => call.name), body, events: anthropicEvents(id, model, content, stopReason) };
}

function compileOpenAiTurn(turn, model) {
  const toolCalls = normalizeToolCalls(turn, 'call_');
  const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  const text = typeof turn.text === 'string' ? turn.text : null;
  const id = `chatcmpl-${digest(`${model}:${text ?? ''}:${toolCalls.map((call) => call.name).join(',')}`)}`;
  const message = { role: 'assistant', content: text };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
  }
  const body = { id, object: 'chat.completion', created: 0, model, choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  return { stopReason: finishReason, toolCalls: toolCalls.map((call) => call.name), body, events: openAiEvents(id, model, text, toolCalls, finishReason) };
}

const DIALECTS = {
  'anthropic-messages': {
    path: ENDPOINTS['anthropic-messages'],
    isScenarioBearing: (body) => Array.isArray(body.tools) && body.tools.length > 0,
    compile: compileAnthropicTurn,
  },
  'openai-chat': {
    path: ENDPOINTS['openai-chat'],
    isScenarioBearing: (body) => Array.isArray(body.tools) && body.tools.some((tool) => tool && tool.type === 'function'),
    compile: compileOpenAiTurn,
  },
};

export function isScenarioBearing(body, dialect) {
  const descriptor = DIALECTS[dialect];
  if (!descriptor) throw new Error(`unknown dialect ${JSON.stringify(dialect)}; known: ${WIRES.join(', ')}`);
  if (!body || typeof body !== 'object') return false;
  return descriptor.isScenarioBearing(body);
}

export function compileTurn(turn, dialect, model) {
  const descriptor = DIALECTS[dialect];
  if (!descriptor) throw new Error(`unknown dialect ${JSON.stringify(dialect)}; known: ${WIRES.join(', ')}`);
  return descriptor.compile(turn, model);
}

function serializeSse(events, dialect) {
  let out = '';
  for (const event of events) {
    if (dialect === 'anthropic-messages') out += `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
    else out += `data: ${JSON.stringify(event.data)}\n\n`;
  }
  if (dialect === 'openai-chat') out += 'data: [DONE]\n\n';
  return out;
}

function validateScenario(scenario, dialect) {
  if (!WIRES.includes(dialect)) throw new Error(`unknown dialect ${JSON.stringify(dialect)}; known: ${WIRES.join(', ')}`);
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new Error('scenario must be an object');
  if (typeof scenario.id !== 'string' || scenario.id === '') throw new Error('scenario.id must be a non-empty string');
  if (typeof scenario.model !== 'string' || scenario.model === '') throw new Error('scenario.model must be a non-empty string');
  if (!Array.isArray(scenario.turns) || scenario.turns.length === 0) throw new Error('scenario.turns must be a non-empty array');
  scenario.turns.forEach((turn, index) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) throw new Error(`scenario.turns[${index}] must be an object`);
    const hasToolCalls = Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0;
    const hasText = typeof turn.text === 'string';
    if (hasToolCalls && hasText) throw new Error(`scenario.turns[${index}] has both toolCalls and text`);
    if (!hasToolCalls && !hasText) throw new Error(`scenario.turns[${index}] must have toolCalls or text`);
    if (hasToolCalls) {
      turn.toolCalls.forEach((call, callIndex) => {
        if (!call || typeof call !== 'object' || typeof call.name !== 'string' || call.name === '') throw new Error(`scenario.turns[${index}].toolCalls[${callIndex}].name must be a non-empty string`);
        if (call.arguments === null || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Error(`scenario.turns[${index}].toolCalls[${callIndex}].arguments must be an object`);
      });
    }
  });
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function handleRequest(req, res, { scenario, tracePath, dialect, descriptor, state }) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'POST' || url.pathname !== descriptor.path) {
    sendJson(res, 404, { error: { type: 'not_found', message: `no route for ${req.method} ${url.pathname}` } });
    return;
  }
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { type: 'invalid_request', message: 'request body is not valid JSON' } });
    return;
  }
  const model = typeof body.model === 'string' && body.model !== '' ? body.model : scenario.model;
  const bearing = isScenarioBearing(body, dialect);
  let turnIndex = null;
  let compiled;
  if (bearing) {
    turnIndex = Math.min(state.cursor, scenario.turns.length - 1);
    compiled = compileTurn(scenario.turns[turnIndex], dialect, model);
    state.cursor = Math.min(state.cursor + 1, scenario.turns.length - 1);
  } else {
    compiled = compileTurn({ text: '' }, dialect, model);
  }
  appendFileSync(tracePath, `${JSON.stringify({
    t: new Date().toISOString(),
    path: url.pathname,
    dialect,
    model,
    classified: bearing ? 'scenario' : 'skipped',
    turn: turnIndex,
    toolCalls: compiled.toolCalls,
    stopReason: compiled.stopReason,
  })}\n`);
  if (body.stream === true) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' });
    res.end(serializeSse(compiled.events, dialect));
  } else {
    sendJson(res, 200, compiled.body);
  }
}

/** Resolves once the server is listening; `close()` releases the port and any open connections. */
export async function startMock({ scenario, tracePath, dialect, port = 0 }) {
  validateScenario(scenario, dialect);
  if (typeof tracePath !== 'string' || tracePath === '') throw new Error('tracePath must be a non-empty string');
  const descriptor = DIALECTS[dialect];
  const state = { cursor: 0 };
  const server = createServer((req, res) => {
    handleRequest(req, res, { scenario, tracePath, dialect, descriptor, state }).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: { type: 'mock_error', message: error.message } });
      else res.end();
    });
  });
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      let closed = false;
      resolveListen({
        port: server.address().port,
        close: () => new Promise((done) => {
          if (closed) { done(); return; }
          closed = true;
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

function post(port, path, body) {
  return new Promise((resolvePost, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'close' } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolvePost({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function selfTestDialect(dialect) {
  const scenario = {
    id: 'self-test',
    model: 'mock-model',
    turns: [
      { toolCalls: [{ name: 'probe', arguments: { value: 1 } }] },
      { text: 'done' },
    ],
  };
  const tracePath = join(tmpdir(), `harness-kit-mock-selftest-${dialect}-${process.pid}.jsonl`);
  const { port, close } = await startMock({ scenario, tracePath, dialect, port: 0 });
  try {
    const path = ENDPOINTS[dialect];
    const tools = [{ type: 'function', name: 'probe' }];
    const first = await post(port, path, { model: 'mock-model', tools, stream: false });
    if (first.status !== 200) throw new Error(`${dialect}: non-streaming status ${first.status}`);
    if (!first.text.includes('probe')) throw new Error(`${dialect}: non-streaming response missing the scripted tool call`);
    const second = await post(port, path, { model: 'mock-model', tools, stream: true });
    if (second.status !== 200) throw new Error(`${dialect}: streaming status ${second.status}`);
    if (!second.text.includes('done')) throw new Error(`${dialect}: streaming response missing the scripted text turn`);
    if (dialect === 'openai-chat' && !second.text.includes('data: [DONE]')) throw new Error(`${dialect}: streaming response missing the [DONE] terminator`);
    if (dialect === 'anthropic-messages' && !second.text.includes('event: message_stop')) throw new Error(`${dialect}: streaming response missing message_stop`);
    const third = await post(port, path, { model: 'mock-model', stream: false });
    if (third.status !== 200) throw new Error(`${dialect}: skipped status ${third.status}`);
    const lines = readFileSync(tracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    if (lines.length !== 3) throw new Error(`${dialect}: expected 3 trace lines, got ${lines.length}`);
    if (lines[0].classified !== 'scenario' || lines[0].turn !== 0) throw new Error(`${dialect}: first request not classified as scenario turn 0`);
    if (lines[1].classified !== 'scenario' || lines[1].turn !== 1) throw new Error(`${dialect}: second request not classified as scenario turn 1`);
    if (lines[2].classified !== 'skipped' || lines[2].turn !== null) throw new Error(`${dialect}: third request not classified as skipped`);
  } finally {
    await close();
    rmSync(tracePath, { force: true });
  }
}

async function selfTest() {
  for (const dialect of WIRES) await selfTestDialect(dialect);
  process.stderr.write(`mock-model self-test: ${WIRES.length} dialects ok\n`);
}

function parseArgs(argv) {
  const options = { port: 0, scenario: null, trace: null, dialect: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') { options.selfTest = true; continue; }
    if (arg === '--port') { index += 1; options.port = Number(argv[index]); continue; }
    if (arg === '--scenario') { index += 1; options.scenario = argv[index]; continue; }
    if (arg === '--trace') { index += 1; options.trace = argv[index]; continue; }
    if (arg === '--dialect') { index += 1; options.dialect = argv[index]; continue; }
    throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) { await selfTest(); return; }
  if (options.scenario === null) throw new Error('--scenario is required');
  if (options.trace === null) throw new Error('--trace is required');
  if (options.dialect === null) throw new Error('--dialect is required');
  const scenario = JSON.parse(readFileSync(options.scenario, 'utf8'));
  const { port } = await startMock({ scenario, tracePath: options.trace, dialect: options.dialect, port: options.port });
  process.stdout.write(`${JSON.stringify({ port })}\n`);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`mock-model: ${error.message}\n`);
    process.exit(1);
  });
}
