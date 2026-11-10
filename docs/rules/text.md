# checks/text

> 定位：text 规则的判据、选项与修法。
> 适用版本：0.1.x

按词表或正则扫描文件文本；支持限定扫描面与白名单。

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `scope` | 全部 | 相对 `workspaceRoot` 的 glob，只扫描命中的文件 |
| `include` | `all` | `all` / `code`（去注释）/ `comments`（只留注释）/ `docs`（只看 Markdown） |
| `deny` | — | 命中即 `error`；字符串按正则处理，或 `{ pattern, flags, message }` |
| `warn` | — | 命中即 `warn`，形状同 `deny` |
| `accept` | — | 行级白名单；整行命中任一条正则时跳过 |

## 示例

```js
{
  use: 'text',
  severity: 'error',
  options: {
    scope: ['src/**'],
    include: 'comments',
    deny: [{ pattern: 'docs/', message: '注释里不要出现内部文档路径' }],
    warn: ['TODO|FIXME'],
    accept: ['CHANGELOG'],
  },
}
```

## 判据

- 注释的识别按扩展名：JS / TS 的 `//`、`/* */`，CSS 的 `/* */`，HTML / Vue 的 `<!-- -->`；
- 遮罩保持长度与换行，命中的行号直接对应原文件；
- 空匹配（如 `a*` 命中空串）会跳过，避免死循环；
- 正则非法按配置错误处理，退出码 `2`。

## 修法

删除或改写命中的片段；确属必要的历史说明放 `CHANGELOG`，并确认 `scope` 已排除。
