# checks/cycles

> 定位：cycles 规则的判据、选项与一致性约定。
> 适用版本：0.3.x

基于相对引用图找环。可选规则，默认关闭。

## 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `ignoreTypeOnly` | `false` | 跳过 `import type` / `export type` 边 |

## 判据

- 图只包含本次扫描到的代码文件（JS / TS / Vue / 样式）；Markdown 与 HTML 的链接不参与建图；
- 相对引用解析失败不进图；
- 边包括静态 import / export、re-export、动态 `import()`、`require()`；
- 算法为 Tarjan SCC：每个强连通分量报一条，按文件路径字典序取代表节点；
- 消息给出一条规范最短环，如 `循环依赖：a.ts → b.ts → a.ts`；
- 自引用（`import './self'`）单独成环并报告。

## 与 oxlint / depcruise 的一致性

- 只比较「参与环的文件集合」，不比较消息文本与顺序；
- 同一仓库只启用一个环检测来源，避免两份结果；
- 升级 oxlint / `vite-plus` 后用同一组夹具重跑，行为变化写 CHANGELOG。

## 修法

拆出共享模块、调整依赖方向，或改用依赖注入。
