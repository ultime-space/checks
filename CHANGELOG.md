# Changelog

## 0.6.2 - 2026-11-27

### Changed

- 包内脚本改为 `vp run` 入口，`check` 与 `prepublishOnly` 不再硬依赖 pnpm 二进制；开发者可用任意包管理器通过脚本入口调用。运行时不变。

## 0.6.1 - 2026-11-27

### Changed

- README 改为入口卡：保留安装、最小可跑、文档地图与边界；配置字段、CLI 参数、输出格式、基线与 Node API 统一到 `USAGE.md`。
- 新增本仓 `checks.config.mjs`，`check` 在构建后串入 `ultime-checks run`；发布前门禁覆盖自身约束，`prepublishOnly` 不再重复构建。

### Fixed

- 抑制指令只认行首注释与合法规则名；散文、字符串里提到关键词不再误报 `checks/suppress`。
- `llms.txt` 的适用版本从 0.4.x 同步到 0.6.x。

## 0.6.0 - 2026-11-22

### Added

- `text` 输出增加源码片段（命中行前后各 1 行、中文按显示宽度对齐、超长行截断）与内置规则入口提示。
- `FormatterMeta` 增加 `maxWarnings` / `hiddenWarnings` / `totalFiles` / `color` / `readSource`；自定义 formatter 可选择消费。
- 内置规则文档覆盖测试：每个规则都必须有 `docs/rules/<name>.md` 且 `explain` 可读。

### Changed

- text 汇总改为「N 个文件命中 / N error / N warnings」，判定行放到最后；`--quiet` 隐藏的 warning 仍计入汇总。
- `--max-warnings` 超预算时在 text 汇总中说明原因。
- 行内抑制 / 基线摘要只由 text formatter 输出一次，不再同时写 stderr。
- text 增加颜色；颜色由输出流 TTY 与环境变量决定，`json` / `sarif` / `github` 不变。

## 0.5.0 - 2026-11-19

### Added

- 配置支持 `use: Rule` 外部规则对象：规则实现归产品，checks 只负责运行；外部规则 ID 使用 `<owner>/<name>` 命名空间。
- `RuleContext` 新增 `match(pattern, file)`，外部规则复用 checks 的 glob 语义。
- 行内抑制支持外部规则 ID 与 `*` 通配。

### Changed

- 外部规则可以用普通 `Error` 携带 `code: 'CONFIG'` 表达配置错误；运行器映射为 `CONFIG_OPTION`。

## 0.4.0 - 2026-11-15

### Changed

- CLI 解析 / 帮助 / 退出码改用内部 `@ultime/cli`；默认命令为 `run`，未注册的首个 token 与 `--` 之后的内容都作为文件参数。
- 零依赖口径改为“零第三方运行时依赖；允许内部 `@ultime/cli`”。

### Fixed

- `USAGE.md` 的 `--rule` / `--ignore-rule` 退出码口径与 `--prune-baseline` 计数口径和实现对齐。

## 0.3.0 - 2026-11-12

### Breaking

- CLI 命令从 `checks` 改为 `ultime-checks`，不保留旧 bin；需要同步更新 `package.json` scripts 与 CI 调用。
- `workspace` 从语义标记变为检测根：`roots` / `ignore` / `overrides.files` / `baseline` 与结果路径都相对它；`--changed` / `--since` 也从该根取改动。

### Added

- Node API 新增 `checker.workspaceRoot`。

### Changed

- 配置不再静默忽略未知字段；`ChecksError` 增加字段路径 `path`。
- 规则 options 的未知键也会报 `CONFIG_OPTION`，路径回填到实际来源（`rules` / `overrides`）。
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
