# AGENTS.md — @ultime/checks

> 给在本仓库工作的 AI 与协作者：入口、可写 / 只读、红线与验收。
> 适用版本：0.3.x

## 先读

1. [`README.md`](./README.md) — 用法与边界。
2. [`USAGE.md`](./USAGE.md) — 配置、CLI、输出、基线、Node API 与 CI 的完整说明。
3. [`rules/README.md`](./rules/README.md) — 本包开发规范。
4. [`docs/rules/`](./docs/rules) — 每条规则的判据与示例。
5. 元仓的 roadmap 维护迁移计划与启用集；本仓只保留规则与实现。

## 可写 / 只读

| 路径 | 条件 |
|---|---|
| `src/**` | 规则与 CLI / API 实现；改动必须带测试 |
| `tests/**` | 与实现同批；夹具与期望先于实现 |
| `docs/rules/**` | 规则行为变化时同步 |
| `package.json` / `vite.config.ts` | 工具链变更；`dependencies` 保持为空 |

只读：`dist/**`、`node_modules/**`。

## 红线

- **测试先行**：先写夹具与期望，再写实现；不许改期望迁就实现。
- **零运行时依赖**：`dependencies` 为空；产物不 import `vite-plus` / `eslint` / `oxlint`。
- **规则 ID 稳定**：`checks/<rule>`；Finding 的 `file` 用 posix 相对路径。
- **不发布构建工具插件**：Vite / Rollup / Rspack / Webpack 插件由使用者自己写。
- **不静默跳过**：无法解析、规则崩溃、超时都要可见。

## 验证

```bash
pnpm check
pnpm test
pnpm build
```
