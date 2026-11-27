import fs from 'node:fs'
import path from 'node:path'
import { builtinRules } from './rules'
import { builtinRuleId, normalizeRuleId } from './rule-id'
import type { Finding } from './types'

interface Directive {
  ruleId: string
  reason?: string
  expires?: string
  line: number
}

export interface SuppressionOptions {
  readFile?: (file: string) => string
  today?: string
  /** 本次运行已配置的规则 ID；缺省只认内置规则。 */
  knownRuleIds?: Set<string>
}

export interface SuppressionResult {
  findings: Finding[]
  diagnostics: Finding[]
  suppressed: number
}

const KEYWORD = 'checks-ignore-next-line'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DIRECTIVE_PREFIX = /^(?:\/\/|\/\*|\*|#|<!--)\s*$/
const RULE_TOKEN = /^(?:\*|[a-z0-9-]+(?:\/[a-z0-9-]+)?)$/

function pick(rest: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(rest)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function parse(line: string): { ruleId: string; reason?: string; expires?: string } | null {
  const index = line.indexOf(KEYWORD)
  if (index === -1) return null
  const prefix = line.slice(0, index)
  if (prefix.trim() !== '' && !DIRECTIVE_PREFIX.test(prefix)) return null
  const after = line.slice(index + KEYWORD.length).trim()
  const [rule, ...rest] = after.split(/\s+/)
  if (!rule || !RULE_TOKEN.test(rule)) return null
  const remainder = rest.join(' ')
  return {
    ruleId: normalizeRuleId(rule),
    ...(pick(remainder, 'reason') ? { reason: pick(remainder, 'reason') } : {}),
    ...(pick(remainder, 'expires') ? { expires: pick(remainder, 'expires') } : {}),
  }
}

export function applySuppressions(
  cwd: string,
  files: string[],
  findings: Finding[],
  options: SuppressionOptions = {},
): SuppressionResult {
  const readFile = options.readFile ?? ((file: string) => fs.readFileSync(path.resolve(cwd, file), 'utf8'))
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const knownRuleIds = options.knownRuleIds ?? new Set(Object.keys(builtinRules).map(builtinRuleId))
  const directives = new Map<string, Map<number, Directive[]>>()
  const diagnostics: Finding[] = []

  for (const file of files) {
    let text = ''
    try {
      text = readFile(file)
    } catch {
      continue
    }
    if (!text.includes(KEYWORD)) continue

    text.split('\n').forEach((line, index) => {
      const parsed = parse(line)
      if (!parsed) return
      const lineNumber = index + 1

      const diagnostic = (message: string, hint: string): void => {
        diagnostics.push({
          ruleId: 'checks/suppress',
          level: 'error',
          file,
          line: lineNumber,
          message,
          hint,
        })
      }

      if (parsed.ruleId !== '*' && !knownRuleIds.has(parsed.ruleId)) {
        diagnostic(`抑制指令的规则不存在：${parsed.ruleId}`, '改成已注册的规则名')
        return
      }
      if (!parsed.reason) {
        diagnostic('抑制指令缺少 reason', '写成 checks-ignore-next-line <rule> reason="原因"')
        return
      }
      if (parsed.expires) {
        if (!DATE.test(parsed.expires)) {
          diagnostic('抑制指令的 expires 格式应为 YYYY-MM-DD', '改为合法日期')
          return
        }
        if (parsed.expires < today) {
          diagnostic(`抑制指令已过期：${parsed.expires}`, '续期或删除该指令')
          return
        }
      }

      const target = lineNumber + 1
      const byLine = directives.get(file) ?? new Map<number, Directive[]>()
      const list = byLine.get(target) ?? []
      list.push({ ...parsed, line: lineNumber })
      byLine.set(target, list)
      directives.set(file, byLine)
    })
  }

  let suppressed = 0
  const kept: Finding[] = []
  for (const finding of findings) {
    const list = finding.line === undefined ? undefined : directives.get(finding.file)?.get(finding.line)
    if (list?.some((directive) => directive.ruleId === '*' || directive.ruleId === finding.ruleId)) {
      suppressed++
      continue
    }
    kept.push(finding)
  }

  return { findings: kept, diagnostics, suppressed }
}
