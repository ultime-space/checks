import type { Rule } from './types'

export const builtinRuleId = (name: string): string => `checks/${name}`

/** 配置里的 `use`：内置字符串按 `checks/` 命名空间，外部 Rule 用自带 `id`。 */
export const resolveRuleId = (use: string | Rule): string =>
  typeof use === 'string' ? builtinRuleId(use) : (use.id ?? builtinRuleId(use.name))

/** 抑制指令与 CLI 参数：裸名补 `checks/`，带命名空间的保持原样，`*` 保持原样。 */
export const normalizeRuleId = (value: string): string => {
  if (value === '*' || value.includes('/')) return value
  return builtinRuleId(value)
}
