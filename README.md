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
| 零第三方运行时依赖，ESM-only，Node `>=22.18` | 网络探测器（外链不在门禁内） |

规则默认**不启用**：配置文件里没写的规则不会运行。

## 安装

```bash
npm i -D @ultime/checks
# 或
pnpm add -D @ultime/checks
```

- 只提供 ESM；Node `>=22.18`；安装后命令名为 `ultime-checks`。
- CLI 解析、帮助与退出码来自内部 `@ultime/cli`；`vite-plus` 只用于本仓开发，不进产物。

## 快速开始

在仓库根建 `checks.config.mjs`：

```js
export default {
  roots: ['src'],
  ignore: ['dist', 'coverage'],
  rules: [
    { use: 'imports', severity: 'error', options: { packageRoots: ['.'], packages: ['@acme/'] } },
    { use: 'unresolved', severity: 'warn', options: { scope: ['src/**'] } },
    { use: 'text', severity: 'error', options: { scope: ['src/**'], deny: ['docs/'] } },
  ],
}
```

运行：

```bash
npx ultime-checks run                  # 按配置检查
npx ultime-checks run --changed        # 只看改动文件
npx ultime-checks rules --json         # 列出内置规则
```

退出码：`0` 通过 / `1` 有 error 或 warning 超预算 / `2` 配置、用法或规则执行失败。

需要 Node API 时：

```ts
import { createChecker } from '@ultime/checks'

const checker = await createChecker({ cwd: process.cwd() })
const report = await checker.lintFiles(['src/**/*.ts'])
```

## 文档

| 文件 | 回答什么 |
|---|---|
| 本页 | 是什么、怎么装、最小可跑、边界 |
| [USAGE](./USAGE.md) | 完整手册：配置字段、全部 CLI 参数、输出格式、基线、抑制、Node API、CI 与排错 |
| [docs/rules](./docs/rules) | 每条内置规则的判据、选项与修法；`ultime-checks explain <rule>` 读取同一份 |
| [SKILLS](./SKILLS.md) | AI 可调用的入口、出口与错误语义 |
| [llms.txt](./llms.txt) | AI 索引：能力、入口与文档路由 |

## 产物与目录

| 路径 | 说明 |
|---|---|
| `dist/` | 构建产物；`prepublishOnly` 强制重建，不进 git |
| `bin/ultime-checks.js` | CLI 薄入口，加载 `dist/cli.js` |
| `docs/rules/` | 随包发布的规则文档 |
| `README.md` / `USAGE.md` / `CHANGELOG.md` | 入口、手册与变更记录 |
| `LICENSE` / `SECURITY.md` / `CONTRIBUTING.md` | 许可、安全与贡献约定 |

发布包不含 `src/`、`tests/`、`scripts/`、`AGENTS.md`、`rules/`。

## 边界

- 不做代码风格、类型检查、构建与打包，也不做自动修复。
- 不联网：外链可达性不在门禁内。
- 不发布打包器插件，不读 `tsconfig` paths。
- 只解析相对引用；裸包名、`node:`、`http(s):` 跳过。

## 版本与兼容

- `0.x` 阶段：minor 可含破坏性变更；API 不承诺稳定。
- 0.6.2：包内脚本改用 `vp run` 入口，去掉对 pnpm 二进制的硬依赖；运行时行为不变。
- 0.6.1：README 改为入口卡，用法细节统一到 `USAGE`；本仓 `check` 串入自检，发布前覆盖自身约束。运行时行为不变。
- 0.6.0：text 输出增加源码片段、规则入口、颜色与 warning 预算提示；`json` / `sarif` / `github` 字段不变。
- 规则 ID：内置 `checks/<rule>`；外部 `<owner>/<name>`；改名视为破坏性变更。
- ESM-only；Node `>=22.18`；产物 `target: node22`。

## 许可

[MIT](./LICENSE)
