# checks/docs

> 定位：docs 规则的判据、选项与修法。
> 适用版本：0.1.x

检查文档的相对链接、锚点、头部标记、开发计划状态与孤儿文档。

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `roots` | `['docs']` | 文档根目录（相对 workspaceRoot） |
| `extraFiles` | `['README.md', 'AGENTS.md']` | 额外参与链接检查与孤立判定的文件 |
| `head` | `{ window: 12, marker: '定位' }` | 前 N 行必须出现的标记 |
| `status` | `{ scope: ['docs/roadmap/**'], marker: '状态' }` | 计划类文档必须出现的状态标记；README 豁免 |
| `anchors` | `'warn'` | `off` / `warn` / `error`；非 ASCII 标题只到 `warn` |
| `generated` | `[]` | 生成物 glob，豁免头部与状态检查 |
| `orphanAllow` | `[]` | 允许不被 README 链接的文档 |

## 判据

- 链接：相对链接必须存在，且逐段精确匹配大小写；外链与锚点-only 链接不探测网络；
- 锚点：按 GitHub 风格 slug 比对标题；标题含非 ASCII 时降级为 `warn`，避免误阻断；
- 头部：非生成物文档前 `window` 行必须有「定位」；
- 状态：命中 `status.scope` 的非 README 文档必须有「状态」；
- 孤儿：每篇非 README 文档必须被某个 README 链接；生成物同样参与孤儿检查。

## 修法

补链接、改大小写、补三行头；生成物在配置里排除，不手改。
