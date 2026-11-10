## 变更

<!-- 这个 PR 解决什么问题；为什么现在做。 -->

## 自查

- [ ] 先有测试：新增 / 修改规则都有正反例与期望，且没有为迁就实现改期望
- [ ] README / 用法 / 示例与代码一致；链接、版本、CHANGELOG 已同步
- [ ] 没有新增第二份正文、重复入口或第二套默认值
- [ ] 规则 ID 仍为 `checks/<rule>`；Finding 用 posix 相对路径
- [ ] 零运行时依赖：`dependencies` 为空，产物不 import `vite-plus` / `eslint` / `oxlint`
- [ ] 不发布构建工具插件；接入示例只放文档
- [ ] 包体边界：`npm pack --dry-run` 不含 `tests` / `rules` / 包根 `AGENTS.md` / 构建配置 / lockfile
- [ ] 已跑 `pnpm check`、`pnpm test`、`pnpm build`

## 审核重点

- 架构 / 边界 / 取舍：
- 风险 / 未覆盖：
