# checks/doc-set

> 定位：doc-set 规则的判据、选项与修法。
> 适用版本：0.1.x

检查包级 AI 文档是否齐全、版本戳是否与 `package.json` 对齐、路由与出口覆盖是否一致，以及包根命名约定。

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `packages` | `[]` | 包根目录；为空时不运行 |
| `files` | `['AGENTS.md', 'rules/README.md', 'llms.txt', 'SKILLS.md']` | 必需文件 |
| `version` | `true` | 前 12 行必须有「适用版本：X.Y.x」并与 `package.json` 的 major.minor 对齐 |
| `routing` | `{ file: 'llms.txt', targets: ['SKILLS.md'] }` | 路由文件必须提到的目标 |
| `exports` | `true` | `SKILLS.md` 与 `exports` 双向覆盖 |
| `naming` | `true` | 包根文档全大写约定名、目录名小写 |
| `rulesMin` | `3` | `rules/` 至少几篇 |
| `allowRootDocs` | 约定名单 | 包根允许的文档名 |

## 判据

- 版本戳只认 `X.Y`，与 `package.json` 的 major.minor 比较；
- 出口覆盖按 `@scope/name` 与 `@scope/name/sub` 映射到 `.` 与 `./sub`；
- 命名只检查包根一层，不递归；
- `rules/` 不存在时跳过数量检查。

## 修法

补文件、同步版本戳与 `SKILLS.md`，或按约定改名。
