import fs from 'node:fs'
import path from 'node:path'
import { ChecksError } from './config'
import type { CheckReport, Finding } from './types'
import { packageVersion } from './version'

export interface BaselineData {
  version: 1
  tool: string
  findings: Record<string, Record<string, number>>
}

export interface BaselineResult {
  findings: Finding[]
  suppressed: number
  stale: number
}

const empty = (): BaselineData => ({ version: 1, tool: packageVersion(), findings: {} })

export function readBaseline(cwd: string, file: string): BaselineData | null {
  const absolute = path.resolve(cwd, file)
  if (!fs.existsSync(absolute)) return null

  try {
    const data = JSON.parse(fs.readFileSync(absolute, 'utf8')) as BaselineData
    if (data.version !== 1 || typeof data.findings !== 'object' || data.findings === null) {
      throw new Error('unsupported baseline shape')
    }
    return data
  } catch (error) {
    throw new ChecksError(
      `基线文件无法解析：${file}（${error instanceof Error ? error.message : String(error)}）`,
      'CONFIG',
    )
  }
}

export function applyBaseline(findings: Finding[], data: BaselineData): BaselineResult {
  const budget = new Map<string, number>()
  for (const [file, rules] of Object.entries(data.findings)) {
    for (const [rule, count] of Object.entries(rules)) {
      if (Number.isInteger(count) && count > 0) budget.set(`${file}\0${rule}`, count)
    }
  }

  const used = new Map<string, number>()
  const kept: Finding[] = []
  let suppressed = 0

  for (const finding of findings) {
    const key = `${finding.file}\0${finding.ruleId}`
    const limit = budget.get(key) ?? 0
    const current = used.get(key) ?? 0
    if (current < limit) {
      used.set(key, current + 1)
      suppressed++
      continue
    }
    kept.push(finding)
  }

  let stale = 0
  for (const [key, limit] of budget) stale += Math.max(0, limit - (used.get(key) ?? 0))

  return { findings: kept, suppressed, stale }
}

const countsFromReport = (report: CheckReport): Record<string, Record<string, number>> => {
  const counts: Record<string, Record<string, number>> = {}
  for (const result of report.results) {
    for (const message of result.messages) {
      if (!message.ruleId) continue
      counts[result.filePath] ??= {}
      counts[result.filePath][message.ruleId] = (counts[result.filePath][message.ruleId] ?? 0) + 1
    }
  }
  return counts
}

function write(cwd: string, file: string, data: BaselineData): BaselineData {
  const absolute = path.resolve(cwd, file)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, `${JSON.stringify(data, null, 2)}\n`)
  return data
}

export function updateBaseline(cwd: string, file: string, report: CheckReport): BaselineData {
  return write(cwd, file, { version: 1, tool: packageVersion(), findings: countsFromReport(report) })
}

/** 只收缩已有条目，不吸收新问题。 */
export function pruneBaseline(cwd: string, file: string, report: CheckReport): BaselineData {
  const old = readBaseline(cwd, file) ?? empty()
  const current = countsFromReport(report)
  const findings: Record<string, Record<string, number>> = {}

  for (const [pathName, rules] of Object.entries(old.findings)) {
    for (const rule of Object.keys(rules)) {
      const count = current[pathName]?.[rule] ?? 0
      if (count <= 0) continue
      findings[pathName] ??= {}
      findings[pathName][rule] = count
    }
  }

  return write(cwd, file, { version: 1, tool: packageVersion(), findings })
}
