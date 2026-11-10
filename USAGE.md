# 使用说明

> 适用版本：0.1.x
> 本文是 `@ultime/checks` 的完整使用手册：配置、CLI、输出、规则、基线、抑制、Node API 与 CI。
> 安装与定位见 [README](./README.md)；规则判据见 [`docs/rules`](./docs/rules)。

---

## 一、安装与运行

```bash
npm i -D @ultime/checks
npx checks --version
npx checks run
```

- 只提供 ESM；Node `>=22.18`。
- 运行时零依赖；`vite-plus` 只用于本仓开发。
- 命令名 `checks`；也可在 `package.json` 的 `scripts` 里直接写 `checks run`。
- 配置文件默认取当前目录的 `checks.config.mjs`；用 `--config <path>` 指定其它文件。

---

## 二、配置

### 2.1 最小配置

```js
// checks.config.mjs
export default {
  roots: ['src'],
  ignore: ['dist', 'coverage'],
  rules: [
    { use: 'unresolved', severity: 'warn', options: { scope: ['src/**'] } },
    { use: 'text', severity: 'error', options: { scope: ['src/**'], deny: ['TODO|FIXME'] } },
  ],
}
```

规则**只运行配置里写出的实例**；不写任何 `rules` 时报告为空。

### 2.2 字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `roots` | `string[]` | `['.']` | 未显式传文件时从这里展开 |
| `ignore` | `string[]` | `[]` | 展开时跳过；不含 `/` 的模式匹配任一路径段，含 `/` 的匹配整条相对路径 |
| `baseline` | `string` | `.checks-baseline.json` | 基线文件路径 |
| `rules` | `RuleConfig[]` | `[]` | 规则实例 |
| `overrides` | `Override[]` | — | 按文件覆盖同名规则 |
| `workspace` | `string` | — | 保留字段，当前只作语义标记 |

`RuleConfig`：

| 字段 | 说明 |
|---|---|
| `use` | 规则名：`imports` / `unresolved` / `cycles` / `text` / `docs` / `doc-set` |
| `severity` | `error` / `warn`；覆盖规则产出的默认级别（`locked` 结果不受影响） |
| `options` | 规则选项；各规则见 [§五「规则」](#五规则) |
| `timeout` | 单规则超时毫秒数，默认 `120000` |

`Override`：

```js
overrides: [
  {
    files: ['tests/**'],
    rules: [{ use: 'text', severity: 'warn', options: { deny: [] } }],
  },
]
```

- `files` 是相对工作根的 glob，命中后按 `use` 合并到同名规则；`options` 浅合并，`severity` 覆盖。
- 未命中的规则不受影响。

### 2.3 扫描范围

- 传给 `run` 的位置参数优先于 `roots`；可以是文件、目录或 glob。
- 忽略目录：`node_modules`、`.git`、`dist`、`coverage`、`.tmp`、`.vite-hooks` 始终跳过。
- glob 只支持 `*`、`**`、`?`、`{a,b}`；`[abc]` 按字面量处理。
- 只收集工作根内的文件；`..` 之外的路径会被丢弃。

---

## 三、CLI

### 3.1 命令

| 命令 | 作用 |
|---|---|
| `checks run [files...]` | 运行检查（默认命令） |
| `checks rules [--json]` | 列出内置规则；`--json` 输出结构化列表 |
| `checks explain <rule>` | 打印规则文档；`<rule>` 可写 `text` 或 `checks/text` |
| `checks --version` / `--help` | 版本 / 帮助 |

### 3.2 选项

| 选项 | 说明 |
|---|---|
| `--config <path>` | 配置文件，默认 `checks.config.mjs` |
| `--cwd <dir>` | 工作根，默认当前目录 |
| `--format <name\|path>` | `text`（默认）/ `json` / `sarif` / `github`，或自定义 formatter 模块 |
| `--output-file <path>` | 结果写入文件（相对 `--cwd`），不再打印到 stdout |
| `--max-warnings <n>` | warning 数超过 `n` 时退出码 1；`0` 表示任何 warning 都失败 |
| `--quiet` | 只显示 error；不影响退出码计算 |
| `--rule <name>` | 只报告指定规则；**规则仍全部执行**，只过滤输出 |
| `--ignore-rule <name>` | 从报告中排除指定规则 |
| `--changed` | 只检查工作区改动（未暂存 + 已暂存 + 未跟踪） |
| `--since <ref>` | 只检查 `git diff <ref>...HEAD` 与工作区改动 |
| `--baseline <path>` | 指定基线文件 |
| `--update-baseline` | 用当前结果重写基线；CI 环境（`CI` 变量存在）拒绝 |
| `--prune-baseline` | 只收缩基线条目，不吸收新问题 |
| `--stdin` | 从 stdin 读取内容，需配合 `--stdin-filename` |
| `--stdin-filename <path>` | stdin 内容对应的文件路径，必须位于工作根内 |

组合限制：

- `--update-baseline` 与 `--prune-baseline` 不能同时使用。
- 基线操作不能与 `--changed` / `--since` 同时使用。
- `--since` 与 `--changed` 不能同时使用。

### 3.3 退出码

| 码 | 含义 |
|---|---|
| `0` | 无 error，且 warning 未超预算 |
| `1` | 有 error，或 `--max-warnings` 超预算 |
| `2` | 配置、用法或规则执行失败（未知规则、正则非法、找不到配置、非 git 环境等） |

---

## 四、输出

### 4.1 text（默认）

```text
src/a.ts
  3:10  error  checks/text  禁止出现：TODO|FIXME
           hint: 删除或改写该片段

1 error(s), 0 warning(s)
· 行内抑制 1 条
· 基线抵掉 2 条，失效 0 条
```

### 4.2 json

```json
{
  "version": 1,
  "results": [
    {
      "filePath": "src/a.ts",
      "messages": [{ "ruleId": "checks/text", "severity": 2, "message": "…", "line": 3, "column": 10 }],
      "errorCount": 1,
      "warningCount": 0
    }
  ],
  "skipped": [],
  "summary": { "errorCount": 1, "warningCount": 0 }
}
```

### 4.3 sarif

SARIF 2.1.0；`ruleId`、`level`、位置与 `partialFingerprints` 均已填充，可直接上传 GitHub Code Scanning。

### 4.4 github

每条形如：

```text
::error file=src/a.ts,line=3,col=10,title=checks/text::禁止出现：TODO|FIXME
```

### 4.5 自定义 formatter

`--format ./my-formatter.mjs`：

```js
// 默认导出 (results, meta) => string
export default function format(results, meta) {
  return results.map((file) => `${file.filePath}: ${file.errorCount}`).join('\n')
}
```

- `results` 是 `CheckReport['results']`，`meta` 包含 `cwd`、`maxWarningsExceeded`、`toolVersion`。
- 路径相对 `--cwd` 解析，文件必须默认导出函数，否则退出码 2。

---

## 五、规则

规则默认级别由规则自身决定；`severity` 可覆盖非 `locked` 结果。

### 5.1 `checks/imports`

相对路径边界、禁止的说明符、内部包依赖声明。

| 选项 | 默认 | 说明 |
|---|---|---|
| `packageRoots` | `[]` | 包根目录；相对引用不得跨出所属包 |
| `packages` | `[]` | 内部包前缀，如 `['@acme/']` |
| `forbid` | `[]` | 禁止的说明符；字符串按正则，或 `{ pattern, scope, message }` |
| `internalSrc` | `packages` 非空时为 `true` | 禁止引用 `<prefix>/<pkg>/src/**` |
| `requireDeclared` | `packages` 非空时为 `true` | 内部包必须出现在所属 `package.json` 依赖中 |

扫描 JS / TS、CSS / SCSS、HTML / Vue 与 Markdown 的相对引用。只解析相对路径；裸包名与 `node:` 跳过。

### 5.2 `checks/unresolved`

报告无法解析的相对引用。

| 选项 | 默认 | 说明 |
|---|---|---|
| `scope` | 全部 | 只扫描命中的 glob |
| `ignore` | `[]` | 说明符正则白名单 |

结果固定 `warn`（`locked`），配置 `severity` 不会把它升级为 error。

### 5.3 `checks/cycles`

基于相对引用图找环；**需要显式配置才会运行**。

| 选项 | 默认 | 说明 |
|---|---|---|
| `ignoreTypeOnly` | `false` | 跳过 `import type` / `export type` 边 |

### 5.4 `checks/text`

| 选项 | 默认 | 说明 |
|---|---|---|
| `scope` | 全部 | 只扫描命中的 glob |
| `include` | `all` | `all` / `code`（去注释）/ `comments`（只留注释）/ `docs`（只看 Markdown） |
| `deny` | — | 命中即 error；字符串按正则，或 `{ pattern, flags, message }` |
| `warn` | — | 命中即 warn，形状同 `deny` |
| `accept` | — | 行级白名单；整行命中任一条正则时跳过 |

`include: 'all'` 会读取 scope 内所有文件；建议把二进制资源放进 `ignore`，或把 `scope` 限定到代码 / 文档。

### 5.5 `checks/docs`

| 选项 | 默认 | 说明 |
|---|---|---|
| `roots` | `['docs']` | 文档根目录 |
| `extraFiles` | `['README.md', 'AGENTS.md']` | 额外参与链接与孤儿判定的文件 |
| `head` | `{ window: 12, marker: '定位' }` | 前 N 行必须出现的标记 |
| `status` | `{ scope: ['docs/roadmap/**'], marker: '状态' }` | 计划类文档的状态标记 |
| `anchors` | `'warn'` | `off` / `warn` / `error`；标题含非 ASCII 时最高 `warn` |
| `generated` | `[]` | 生成物 glob，豁免头部与状态检查 |
| `orphanAllow` | `[]` | 允许不被 README 链接的文档 |

### 5.6 `checks/doc-set`

检查包级 AI 文档；`packages` 为空时不运行。

| 选项 | 默认 | 说明 |
|---|---|---|
| `packages` | `[]` | 包根目录 |
| `files` | `['AGENTS.md', 'rules/README.md', 'llms.txt', 'SKILLS.md']` | 必需文件 |
| `version` | `true` | 前 12 行「适用版本：X.Y.x」与 `package.json` 的 major.minor 对齐 |
| `routing` | `{ file: 'llms.txt', targets: ['SKILLS.md'] }` | 路由文件必须提到的目标 |
| `exports` | `true` | `SKILLS.md` 与 `exports` 双向覆盖 |
| `naming` | `true` | 包根文档全大写、目录名小写 |
| `rulesMin` | `3` | `rules/` 至少几篇 |
| `allowRootDocs` | 约定名单 | 包根允许的文档名 |

逐条判据与修法见 [`docs/rules`](./docs/rules)。

---

## 六、行内抑制

写在违规行**上一行**：

```js
// checks-ignore-next-line checks/text reason="历史文案，待迁移" expires="2026-12-31"
const legacy = '旧文案'
```

- 规则名可写 `text` 或 `checks/text`。
- `reason` 必填；缺失时不生效，并报 `checks/suppress`。
- `expires` 为 `YYYY-MM-DD`；过期后报 `checks/suppress`。
- 只能抑制带行号的结果；文件级结果无法行内抑制。
- 兼容旧写法：`boundary-allow: <理由>` 会抑制下一行的**所有规则**，理由记为 `legacy`；迁移完成后应删除。

---

## 七、基线

```json
{
  "version": 1,
  "tool": "0.1.0",
  "findings": {
    "src/legacy/a.ts": { "checks/text": 2 },
    "src/legacy/b.ts": { "checks/imports": 1 }
  }
}
```

- 按 `file → rule → 计数` 抵消；同一文件同一规则最多抵消记录的数量，不按行匹配。
- 同一文件同一规则新增问题会先占用预算，可能导致旧问题重新出现；这是计数式基线的已知代价。
- `--update-baseline`：用当前结果**重写**；`CI` 环境变量存在时拒绝。
- `--prune-baseline`：只保留仍存在的条目，数量取当前值与旧值的较小者。
- 报告会显示 `· 基线抵掉 N 条，失效 M 条`；`M > 0` 时可用 `--prune-baseline` 收缩。

---

## 八、增量检查

```bash
checks run --changed
checks run --since origin/main
```

| 模式 | 取哪些文件 |
|---|---|
| `--changed` | 未暂存改动 + 已暂存改动 + 未跟踪文件 |
| `--since <ref>` | `git diff <ref>...HEAD` + 未暂存改动 + 已暂存改动 |

- 依赖 git；非 git 仓库或 git 不可用时退出码 2。
- 只检查展开范围内、且命中改动集合的文件。
- CI 里用 `--since` 时，checkout 需 `fetch-depth: 0`。

---

## 九、Node API

```ts
import { createChecker } from '@ultime/checks'

const checker = await createChecker({
  cwd: process.cwd(),
  config: 'checks.config.mjs', // 或直接传配置对象；省略时读默认文件
  baseline: '.checks-baseline.json', // false 关闭
  resolver: (specifier, importer) => null, // 可选：解析别名
})

const report = await checker.lintFiles(['src/**/*.ts'])
const single = await checker.lintText('const a = 1', { filePath: 'src/a.ts' })
```

### 9.1 `createChecker`

| 选项 | 说明 |
|---|---|
| `cwd` | 工作根，默认 `process.cwd()` |
| `config` | 配置文件路径或配置对象 |
| `baseline` | 基线路径；`false` 关闭；缺省用配置值或 `.checks-baseline.json` |
| `resolver` | `(specifier, importer) => path \| null`，供 `imports` / `unresolved` 使用 |

配置错误抛 `ChecksError`（`code` 为 `CONFIG` / `USAGE` / `RULE`）。

### 9.2 `lintFiles` / `lintText`

| 参数 | 说明 |
|---|---|
| `patterns` | 文件、目录或 glob；省略时用 `roots` |
| `options.baseline` | 本次是否应用基线，默认 `true` |
| `options.onlyFiles` | 只检查这些相对路径（`--changed` / `--since` 内部使用） |
| `options.signal` | `AbortSignal` |
| `filePath` | `lintText` 必填，必须位于工作根内 |

### 9.3 报告

```ts
interface CheckReport {
  results: Array<{
    filePath: string
    messages: Array<{ ruleId: string; severity: 1 | 2; message: string; line?: number; column?: number; hint?: string }>
    errorCount: number
    warningCount: number
  }>
  errorCount: number
  warningCount: number
  skipped: Array<{ ruleId: string; reason: string }>
  suppressedCount?: number
  baseline?: { suppressed: number; stale: number }
}
```

路径统一为相对 `cwd` 的 posix 路径。

---

## 十、CI 集成

### 10.1 GitHub Actions：注解 + 阻断

```yaml
name: checks
on: [push, pull_request]

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -D @ultime/checks
      - run: npx checks run --format github
```

PR 想只看改动时，把最后一行换成 `npx checks run --since origin/${{ github.base_ref }} --format github`；需要 `fetch-depth: 0`。

### 10.2 GitHub Code Scanning：SARIF

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
  - run: npm i -D @ultime/checks
  - run: npx checks run --format sarif --output-file checks.sarif
  - uses: github/codeql-action/upload-sarif@v3
    with:
      sarif_file: checks.sarif
```

---

## 十一、排错

| 现象 | 原因 / 处理 |
|---|---|
| `找不到配置文件` | 建 `checks.config.mjs`，或用 `--config` 指定 |
| 退出码 2 + `未知规则` | `use` 拼写错误；用 `checks rules` 查看 |
| `无法解析引用` 不阻断 | `unresolved` 固定 `warn`（`locked`），当前不支持升级为 error；先修路径，或把阻断交给 `imports` 的 `forbid` 等规则 |
| `checks/suppress` 报缺少 reason | 指令必须写 `reason="…"` |
| `checks/suppress` 报已过期 | 续期 `expires` 或删除指令 |
| `基线文件无法解析` | 必须是 `version: 1` 且 `findings` 为对象 |
| `--changed` 退出码 2 | 当前目录不是 git 仓库，或 git 不可用 |
| 自定义 formatter 退出码 2 | 路径相对 `--cwd`，且必须默认导出函数 |
| 锚点误报 | 标题含非 ASCII 时只到 `warn`；可把 `anchors` 设为 `off` |

---

## 十二、局限

- 静态检查：不做类型检查、运行时验证与自动修复。
- 只解析相对引用；`tsconfig` paths、打包器别名需要宿主注入 `resolver` 或改用 `forbid`。
- 外链不探测；SARIF / `github` 格式只含本地结果。
- 文本规则读取 scope 内所有文件；二进制资源请放进 `ignore`。
- 锚点按 GitHub slug 近似；非 ASCII 标题降级为 `warn`。
- 基线按计数抵消，不按行指纹匹配。
