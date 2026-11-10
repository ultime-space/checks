# 开发约定

## 测试先行

1. 先写夹具：正例、反例、边界各一组；
2. 期望写死 `file`、`line`、`ruleId`、`level`、`message`；
3. 再写实现；不为了通过而改期望，确需改写在 PR 说明原因。

## 契约

- 对外结果用 `CheckReport`：`results[].messages[]` 贴 ESLint 的 `LintResult` 字段，`severity` 用 `1 / 2`；
- 内部 `Finding` 用 `error / warn`，规则返回它，API 负责映射；
- 路径统一 posix、相对 `workspaceRoot`；不输出绝对路径与时间戳；
- 退出码：`0` 通过 / `1` 有 error 或 warning 超预算 / `2` 配置、用法或规则执行失败。

## 产物边界

- `dependencies` 为空；开发期可以用 `vite-plus` 的 CLI 与配置；
- 产物不得 import `vite-plus` / `eslint` / `oxlint`；
- 不发布构建工具插件；ESLint 兼容适配层是后续可选入口。
