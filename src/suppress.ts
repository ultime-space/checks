import fs from 'node:fs'
import path from 'node:path'
import { builtinRules } from './rules'
import type { Finding } from './types'

interface Directive {
  ruleId: string
  reason?: string
  expires?: string
  line: number
}

export interface SuppressionResult {
  findings: Finding[]
  diagnostics: Finding[]
  suppressed: number
}

const KEYWORD = 'checks-ignore-next-line'
const DATE = /^\d{4}-\d{2}-\d{2}$/

const normalizeRuleId = (value: string): string => (value.startsWith('checks/') ? value : `checks/${value}`)

function pick(rest: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(rest)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function parse(line: string): { ruleId: string; reason?: string; expires?: string } | null {
  const index = line.indexOf(KEYWORD)
  if (index === -1) return null
  const after = line.slice(index + KEYWORD.length).trim()
  const [rule, ...rest] = after.split(/\s+/)
  if (!rule || rule.includes('<') || rule.includes('>')) return null
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
  readFile: (file: string) => string = (file) => fs.readFileSync(path.resolve(cwd, file), 'utf8'),
  today = new Date().toISOString().slice(0, 10),
): SuppressionResult {
  const directives = new Map<string, Map<number, Directive[]>>()
  const diagnostics: Finding[] = []

  for (const file of files) {
    let text = ''
    try {
      text = readFile(file)
    } catch {
      continue
    }
    if (!text.includes(KEYWORD) && !text.includes('boundary-allow:')) continue

    text.split('\n').forEach((line, index) => {
      const legacy = line.includes('boundary-allow:')
      if (legacy) {
        const target = index + 2
        const byLine = directives.get(file) ?? new Map<number, Directive[]>()
        const list = byLine.get(target) ?? []
        list.push({ ruleId: '*', reason: 'legacy', line: index + 1 })
        byLine.set(target, list)
        directives.set(file, byLine)
        return
      }

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

      if (!builtinRules[parsed.ruleId.slice('checks/'.length)]) {
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
