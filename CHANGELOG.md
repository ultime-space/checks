# Changelog

## 0.1.0 - 2026-11-11

### Added

- 六条内置规则：`checks/imports`、`checks/unresolved`、`checks/cycles`、`checks/text`、`checks/docs`、`checks/doc-set`。
- CLI：`checks run` / `rules` / `explain`；支持 `--changed` / `--since`、`--stdin`、`--max-warnings`。
- Node API：`createChecker` / `lintFiles` / `lintText`，结果贴 ESLint `LintResult` 形状。
- 存量接入：`.checks-baseline.json`、`--update-baseline` / `--prune-baseline`、`checks-ignore-next-line`。
- 输出：`text` / `json` / `sarif` / `github`，支持自定义 formatter 模块。
