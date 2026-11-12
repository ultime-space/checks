# Changelog

## 0.3.0 - 2026-11-12

### Breaking

- CLI 命令从 `checks` 改为 `ultime-checks`，不保留旧 bin；需要同步更新 `package.json` scripts 与 CI 调用。
- `workspace` 从语义标记变为检测根：`roots` / `ignore` / `overrides.files` / `baseline` 与结果路径都相对它；`--changed` / `--since` 也从该根取改动。

### Added

- Node API 新增 `checker.workspaceRoot`。

### Changed

- 配置不再静默忽略未知字段；`ChecksError` 增加字段路径 `path`。
- 错误码细化为 `CONFIG` / `CONFIG_FIELD` / `CONFIG_RULE` / `CONFIG_OPTION` / `USAGE` / `RULE`；规则 options 非法统一报 `CONFIG_OPTION`。
- 未知规则改为在 `createChecker` 阶段失败，不再等第一个文件。

## 0.2.1 - 2026-11-11

### Changed

- 发布产物默认压缩：`dist/*.js` 开启 `minify`，去掉格式与注释；`dist/*.d.ts` 保持可读，`sourcemap` 仍不随包发布。
- `README` 同步产物说明；`AGENTS.md` / `llms.txt` / `SKILLS.md` 版本戳同步到 0.2.x。

## 0.2.0 - 2026-11-11

### Changed

- `checks/cycles` 只对代码文件建图；Markdown / HTML 链接不再参与。
- 移除 legacy `boundary-allow:` 抑制语法，统一使用 `checks-ignore-next-line`。

## 0.1.1 - 2026-11-11

### Changed

- 验证 Trusted Publishing（OIDC）发布链路；无运行时变更。

## 0.1.0 - 2026-11-11

### Added

- 六条内置规则：`checks/imports`、`checks/unresolved`、`checks/cycles`、`checks/text`、`checks/docs`、`checks/doc-set`。
- CLI：`checks run` / `rules` / `explain`；支持 `--changed` / `--since`、`--stdin`、`--max-warnings`。
- Node API：`createChecker` / `lintFiles` / `lintText`，结果贴 ESLint `LintResult` 形状。
- 存量接入：`.checks-baseline.json`、`--update-baseline` / `--prune-baseline`、`checks-ignore-next-line`。
- 输出：`text` / `json` / `sarif` / `github`，支持自定义 formatter 模块。
