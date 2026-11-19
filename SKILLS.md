# SKILLS

> 适用版本：0.5.x
> 定位：本包可调用的能力表。

| 能力 | 入口 | 说明 |
|---|---|---|
| 使用说明 | [`USAGE.md`](./USAGE.md) | 配置字段、CLI 全量参数、输出格式、基线、抑制、Node API 与 CI 示例 |
| 运行检查 | `ultime-checks run` | 按 `checks.config.mjs` 检查；退出码 0 / 1 / 2 |
| 只查改动 | `ultime-checks run --changed` / `--since <ref>` | 依赖 git，非 git 环境退出码 2 |
| 检测根 | 配置 `workspace` | roots / baseline / overrides 与结果路径都相对该根 |
| 存量接入 | `ultime-checks run --update-baseline` / `--prune-baseline` | 基线按 `file → rule → 计数` |
| 规则发现 | `ultime-checks rules` / `ultime-checks explain <rule>` | 列出内置规则或打印内置规则文档 |
| 外部规则 | 配置 `use: Rule` | 规则实现由产品包提供，checks 只负责运行（0.5.0+） |
| Node API | `@ultime/checks` | `createChecker` / `lintFiles` / `lintText` |

规则实现与判据见 [docs/rules](./docs/rules)。
