# @ultime/checks

通用的仓库约束检测工具：CLI 与 Node API 共用一次遍历，规则由配置注入。

[![npm](https://img.shields.io/npm/v/@ultime/checks)](https://www.npmjs.com/package/@ultime/checks)
[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-black)](./package.json)

## 是什么 / 不是什么

| 是 | 不是 |
|---|---|
| 仓库约束检测器：边界、引用、文档、词表、依赖环 | 代码风格 / 格式化工具（用 `vp lint` / `eslint` / `oxlint`） |
| 规则逻辑 + 配置：项目词表、路径与包名全部来自配置 | 类型检查器或构建工具 |
| 一次遍历输出 `text` / `json` / `sarif` / `github` | 自动修复器 |
| 零运行时依赖，ESM-only，Node `>=22.18` | 网络探测器（外链不在门禁内） |

规则默认**不启用**：配置文件里没写的规则不会运行。

## 安装

```bash
npm i -D @ultime/checks
# 或
pnpm add -D @ultime/checks
```

- 运行时零依赖；`vite-plus` 只用于本仓开发，不进产物。
- 只提供 ESM；Node `>=22.18`。
- 安装后命令名为 `checks`。

## 快速开始

1. 在仓库根建 `checks.config.mjs`：

```js
export default {
  roots: ['src'],
  ignore: ['dist', 'coverage'],
  rules: [
    { use: 'unresolved', severity: 'warn', options: { scope: ['src/**'] } },
    { use: 'imports', severity: 'error', options: { packageRoots: ['.'], packages: ['@acme/'] } },
    {
      use: 'text',
      severity: 'error',
      options: {
        scope: ['src/**'],
        include: 'comments',
        deny: ['docs/', { pattern: 'TODO|FIXME', message: '不要留 TODO' }],
      },
    },
  ],
}
```

2. 运行：

```bash
npx checks run
npx checks run src --format json
npx checks run --changed
```

3. 退出码：`0` 通过 / `1` 有 error 或 warning 超预算 / `2` 配置、用法或规则执行失败。

配置字段、全部 CLI 参数、基线、抑制、Node API 与 CI 示例见 [USAGE](./USAGE.md)。

## 用法

### CLI

| 命令 | 作用 |
|---|---|
| `checks run [files...]` | 按配置检查；`files` 是路径或 glob，省略时用 `roots` |
| `checks rules [--json]` | 列出内置规则 |
| `checks explain <rule>` | 打印规则文档 |
| `checks --version` / `--help` | 版本 / 帮助 |

常用参数：`--format`、`--output-file`、`--max-warnings`、`--quiet`、`--changed`、`--since <ref>`、`--config`、`--cwd`、`--rule`、`--ignore-rule`、`--stdin`、`--update-baseline`、`--prune-baseline`。全量说明见 [USAGE](./USAGE.md)。

### 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `roots` | `['.']` | 未显式传文件时的扫描根 |
| `ignore` | `[]` | 展开时跳过的路径 / glob |
| `baseline` | `.checks-baseline.json` | 基线文件路径 |
| `rules` | `[]` | 规则实例；`use` 为规则名，`severity` 为 `error` / `warn` |
| `overrides` | — | 按 glob 覆盖同名规则的选项 |
| `workspace` | — | 保留字段，当前只作语义标记 |

### 规则

| 规则 | 用途 |
|---|---|
| [`checks/imports`](./docs/rules/imports.md) | 相对路径边界、禁止的说明符、内部包依赖声明 |
| [`checks/unresolved`](./docs/rules/unresolved.md) | 无法解析的相对引用（固定 `warn`） |
| [`checks/cycles`](./docs/rules/cycles.md) | 相对引用图找环（可选，需显式配置） |
| [`checks/text`](./docs/rules/text.md) | 按词表 / 正则扫描文本 |
| [`checks/docs`](./docs/rules/docs.md) | 相对链接、锚点、头部标记、计划状态、孤儿文档 |
| [`checks/doc-set`](./docs/rules/doc-set.md) | 包级 AI 文档齐全、版本戳、路由、出口覆盖、命名 |

每条规则的选项、判据与修法在 `docs/rules/<rule>.md`。

### 存量接入

```bash
checks run --update-baseline   # 用当前结果重写基线（CI 环境拒绝）
checks run --prune-baseline    # 只收缩已有基线条目
```

单行例外写在违规行上一行：

```js
// checks-ignore-next-line checks/text reason="历史文案，待迁移" expires="2026-12-31"
```

`reason` 必填；`expires` 过期后会报 `checks/suppress`。基线按 `file → rule → 计数` 记录，按计数抵消，不按行匹配。

### Node API

```ts
import { createChecker } from '@ultime/checks'

const checker = await createChecker({ cwd: process.cwd() })
const report = await checker.lintFiles(['src/**/*.ts'])
const single = await checker.lintText('const a = 1', { filePath: 'src/a.ts' })

console.log(report.errorCount, report.warningCount, report.results)
```

- `createChecker(options)`：`cwd` / `config`（路径或对象）/ `baseline`（路径或 `false`）/ `resolver`。
- `report.results` 贴 ESLint `LintResult` 形状（`filePath` / `messages[{ ruleId, severity, message, line, column }]`）。
- 路径均为相对 `cwd` 的 posix 路径。

## 产物与目录

| 路径 | 说明 |
|---|---|
| `dist/` | 构建产物；`prepublishOnly` 强制重建，不进 git |
| `bin/checks.js` | CLI 薄入口，加载 `dist/cli.js` |
| `docs/rules/` | 随包发布的规则文档；`checks explain` 读取这里 |
| `README.md` / `USAGE.md` / `CHANGELOG.md` | 使用说明与变更记录 |
| `LICENSE` / `SECURITY.md` / `CONTRIBUTING.md` | 许可、安全与贡献约定 |

发布包不含 `src/`、`tests/`、`scripts/`、`AGENTS.md`、`rules/`。
`dist/*.js` 默认压缩；类型与声明保持可读，注释与说明留在源码与文档。

## 边界

- 不做代码风格、类型检查、构建与打包。
- 不做自动修复；只报告。
- 不联网：外链可达性不在门禁内。
- 不发布 Vite / Rollup / Rspack / Webpack 插件。
- 不读 `tsconfig` paths；别名由宿主的 `resolver` 或 `forbid` 处理。
- 只解析相对引用；裸包名、`node:`、`http(s):` 跳过。

## 版本与兼容

- `0.x` 阶段：minor 可含破坏性变更；API 不承诺稳定。
- 规则 ID `checks/<rule>` 稳定；改名视为破坏性变更。
- `checks/unresolved` 固定 `warn`，配置 `severity` 不改变（避免把「解析失败」误当阻断）。
- ESM-only；Node `>=22.18`；产物 `target: node22`。

## 许可

[MIT](./LICENSE)
