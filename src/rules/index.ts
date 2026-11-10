import type { Rule } from '../types'
import { cyclesRule } from './cycles'
import { docSetRule } from './doc-set'
import { docsRule } from './docs'
import { importsRule } from './imports'
import { textRule } from './text'
import { unresolvedRule } from './unresolved'

export const builtinRules: Record<string, Rule> = {
  cycles: cyclesRule,
  docs: docsRule,
  'doc-set': docSetRule,
  imports: importsRule,
  text: textRule,
  unresolved: unresolvedRule,
}

export const ruleList = (): Rule[] =>
  Object.values(builtinRules).sort((left, right) => left.name.localeCompare(right.name))
