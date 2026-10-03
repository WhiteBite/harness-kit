# harness-kit

[English](README.md) | **Русский**

> Один канонический реестр и примитивы без зависимостей для подключения AI coding harness'ов — Claude Code, Codex CLI, OpenCode 1.x/2.x, Gemini CLI, Qwen, Cursor, Windsurf, Kiro, Devin, VS Code Copilot, Crush, Cline, Aider, — чтобы инструменты перестали по-своему пересобирать пути конфигов, семантику мержа и symlink-установки.

## Быстрый старт

```bash
npm install
npm test
npm run self-test
```

Нулевые рантайм-зависимости, Node >= 18, чистый ESM (совместим с Bun). Опубликован в npm как `@whitebite/harness-kit`; глубокие интеграции по-прежнему вендорят исходники за sha256-манифестом (см. [docs/consumption.md](docs/consumption.md)).

## Кому это нужно

- Авторам инструментов, которые ставят хуки, скиллы или правила в AI coding-агентов и каждый раз заново учат диалект конфига каждого harness'а.
- Командам, чьи репо трогают несколько таких инструментов, а hook-конфиги затирают друг друга.
- Мейнтейнерам, которым нужен один выверенный источник правды для путей конфигов вместо трёх расходящихся копий.

## Сценарии

- Найти канонический путь конфига, shape хуков, имена событий и единицу таймаута для любого поддерживаемого harness'а.
- Смержить свои hook-записи в общий конфиг, не трогая записи другого инструмента (owner-scoped strip-then-append).
- Отслеживать, какие записи принадлежат вам, через хешированный sidecar-манифест, устойчивый к дрейфу command-строк.
- Писать JSON-конфиги атомарно: с проверенными бэкапами, отказом на symlink и ретраями rename на Windows.
- Ставить агентские скиллы в skill-директории harness'ов с безопасной классификацией состояния (ручное содержимое не затирается никогда).
- Рендерить шаблоны hook-конфигов с полным JSON-экранированием, чтобы Windows-пути выживали в оба конца.
- Агрегировать здоровье установки по поверхностям со структурированными находками — дрейф конфига, гниение marker-блока, git `core.hooksPath`, — а форматирование и exit-политика остаются на стороне потребителя.

## Примеры

### Мерж в общий конфиг codex-стиля

```js
import { mergeHooks } from './vendor/harness-kit/src/index.mjs';

const template = { hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node /abs/scan.mjs --pre-tool' }] }] } };
const isMine = (command) => typeof command === 'string' && command.includes('--pre-tool');

const merged = mergeHooks(existingConfig, template, { shape: 'nested-hooks', isMine });
// foreign entries survive; re-running the merge is byte-identical; an empty template uninstalls only your entries
```

### Записать и проверить ownership

```js
import { recordOwnership, ownedLocators, entryMatchesHash } from './vendor/harness-kit/src/index.mjs';

recordOwnership(repoRoot, 'my-tool', '.codex/hooks.json', merged, [['hooks', 'PreToolUse', 0]]);
const [record] = ownedLocators(repoRoot, 'my-tool', '.codex/hooks.json');
const intact = entryMatchesHash(currentConfig, record); // false after any out-of-band edit
```

### Продиагностировать установку по поверхностям

```js
import { checkInstall, resolveHooksDir, extractCliPath } from './vendor/harness-kit/src/index.mjs';

const hooksDir = resolveHooksDir(repoRoot); // null when .git is absent
const findings = checkInstall(repoRoot, {
  surfaces: [
    { id: 'codex', kind: 'hook-config', path: '.codex/hooks.json', shape: 'nested-hooks', identify: isMine },
    hooksDir === null ? null : {
      id: 'git',
      kind: 'marker-block',
      path: `${hooksDir}/pre-commit`,
      variant: 'shell-block',
      markerId: 'slop-gate',
      extract: (text) => extractCliPath(text, /node\s+"([^"]+)"\s+--staged/),
    },
  ].filter(Boolean),
});
// [{ surface: 'codex', status: 'ok', detail: null }, { surface: 'git', status: 'stale', detail: '/gone/scan.mjs' }]
```

## Почему этот вариант

- **Реестр как данные.** `registry/harnesses.json` — языконейтральный контракт с JSON Schema: не-JS инструменты читают те же факты, что и JS.
- **Owner-scoped мержи.** Strip-then-append по sidecar-манифесту ownership с sha256-хешами записей; матчинг по подстроке команды — только миграционный fallback. Чужие байты выживают by construction, а coexistence-спайк на двух владельцев — закоммиченный тест.
- **Шесть реальных config shapes, один примитив.** nested-hooks (Claude/Codex/Gemini/Qwen), root-events (Devin), versioned-flat (Cursor), versioned-typed (Copilot), flat-matcher (Crush), hooks-array (Kiro).
- **Нулевые зависимости, вендорное потребление.** Никаких рантайм-зависимостей и никакого npx в горячих путях; потребители вендорят кит и сверяют его по детерминированному hash-манифесту.
- **Проверено саботажем.** `npm run self-test` валидирует реестр, падает на sabotage-фикстурах, терпит неизвестные ключи (forward compatibility) и прогоняет coexistence двух владельцев по каждой mergeable-строке реестра.

## Статус

Фаза 3: doctor-агрегация — находки `checkInstall` по hook-config и marker-block поверхностям, read-side маркера, резолвер git `core.hooksPath`, извлечение CLI-пуха силами вызывающего — поверх канонического реестра фазы 2 (14 строк harness'ов, сведённых из трёх независимых реализаций), примитивов merge/ownership/atomic/template/symlink/marker-block/drift, тест-сьюта, self-test и hash-манифеста. Принят семейными инструментами: repo-aeo (symlink-и скиллов), stop-ai-slop (хуки, правила, pre-commit) и dejavu-gates (мержи, шаблоны, дрейф) вендорят кит за sha256 sync-check и golden byte-diff гейтом; см. [docs/consumption.md](docs/consumption.md) и [docs/coexistence.md](docs/coexistence.md).

## Лицензия

MIT — см. [LICENSE](LICENSE).
