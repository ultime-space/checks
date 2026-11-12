# 规则写法

## 契约

- 规则导出 `{ name, description, run(ctx, options) }`；
- `run` 返回 `Finding[]`，`ruleId` 固定为 `checks/<name>`；
- `file` 用 posix 相对路径；行号从 1 开始；
- 规则只读 `ctx`，不直接读进程状态、环境变量或网络。

## 选项

- 规则必须声明 `optionKeys`，列出接受的 options 键；运行时据此拒绝未知键，避免拼错导致规则静默失效；
- 选项从 `Record<string, unknown>` 解析，非法值抛 `ChecksError(..., 'CONFIG')`；运行时统一映射为 `CONFIG_OPTION` 并回填规则实例路径；
- 默认值写进文档，不藏在实现里；
- 不新增配置项，除非已有两个以上规则需要。

## 测试

- 每条规则一组 valid / invalid / edge 夹具；
- 期望写死 `file`、`line`、`ruleId`、`level`、`message`；
- 先写失败用例，再写实现；不为通过改期望。
