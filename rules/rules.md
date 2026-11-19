# 规则写法

## 契约

- 规则导出 `{ name, description, run(ctx, options) }`；
- `run` 返回 `Finding[]`；运行器统一写入规则 ID（内置 `checks/<name>`，外部用规则 `id`）；
- `file` 用 posix 相对路径；行号从 1 开始；
- 规则只读 `ctx`，不直接读进程状态、环境变量或网络。

## 选项

- 规则必须声明 `optionKeys`，列出接受的 options 键；运行时据此拒绝未知键，避免拼错导致规则静默失效；
- 选项从 `Record<string, unknown>` 解析，非法值抛 `ChecksError(..., 'CONFIG')`；运行时统一映射为 `CONFIG_OPTION` 并回填规则实例路径；
- 默认值写进文档，不藏在实现里；
- 不新增配置项，除非已有两个以上规则需要。

## 外部规则

- 依赖产品 schema 的规则由产品自己实现，checks 只提供运行器；不把产品 schema 写进内置规则。
- 配置里直接 import `Rule` 对象：`use: rule`；规则必须带命名空间 `id`（如 `core/tokens`），不能占用 `checks/*`。
- 外部规则不 import `@ultime/checks` 的错误类；配置错误用普通 `Error` 携带 `code: 'CONFIG'`，运行器映射为 `CONFIG_OPTION`。
- 需要路径匹配时用 `ctx.match(pattern, file)`，不要复制 checks 的 glob 实现。
- `rules` / `explain` 只列内置规则；外部规则的文档由产品维护。

## 测试

- 每条规则一组 valid / invalid / edge 夹具；
- 期望写死 `file`、`line`、`ruleId`、`level`、`message`；
- 先写失败用例，再写实现；不为通过改期望。
