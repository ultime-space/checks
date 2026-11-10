# Contributing

> 给贡献者与 AI 的最短协作规则。用法见 [README](./README.md)，开发约定见 [rules](./rules/README.md)。

## Git 流程

1. 从 `main` 切 `feat/<主题>` / `fix/<主题>` / `docs-<主题>`。
2. 一次提交一件事，提交信息用 `type(scope): subject`，正文写「为什么」。
3. push 分支并开 PR；CI 必须通过，评论必须解决。
4. 用 rebase / squash 合并，删除分支；`main` 不保留中间提交。
5. 不直接 push `main`，不 force push、不删除 `main`。
6. 发布按包版本打 `v*` tag，由 CI 执行。

## 改动规则

- **测试先行**：先写夹具与期望，再写实现；不允许改期望迁就实现。
- **契约稳定**：规则 ID 用 `checks/<rule>`；对外结果是 `CheckReport`，贴 ESLint `LintResult` 形状。
- **零运行时依赖**：`dependencies` 保持为空；开发期可以用 `vite-plus` 的 CLI 与配置。
- **不发布构建工具插件**：Vite / Rollup / Rspack / Webpack 插件由使用者自己写。
- **不静默跳过**：无法解析、规则崩溃、超时都要可见。

## Review

提交 PR 前自查：

- 测试：正反例、边界、期望是否齐全；旧脚本迁移是否先固化输出。
- 文档：规则行为变化是否同步 `docs/rules/<rule>.md`。
- 冗余：同一事实只有一份正文；新增说明先改真源。
- 漂移：`package.json` / README / CHANGELOG 版本是否一致。
- 包体：`npm pack --dry-run` 是否只含 `bin` / `dist` / 文档入口。

## 验证

```bash
pnpm check
pnpm test
pnpm build
npm pack --dry-run
```
