import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ChecksError } from '../config'
import type { CheckReport } from '../types'
import { packageVersion } from '../version'

export interface FormatterMeta {
  cwd: string
  maxWarningsExceeded?: boolean
  toolVersion?: string
}

export type Formatter = (report: CheckReport, meta: FormatterMeta) => string

export const formatText: Formatter = (report) => {
  const lines: string[] = []

  for (const result of report.results) {
    if (result.messages.length === 0) continue
    lines.push(result.filePath)
    for (const message of result.messages) {
      const level = message.severity === 2 ? 'error' : 'warn'
      const position = `${message.line ?? 0}:${message.column ?? 1}`
      lines.push(`  ${position}  ${level}  ${message.ruleId}  ${message.message}`)
      if (message.hint) lines.push(`           hint: ${message.hint}`)
    }
    lines.push('')
  }

  if (report.errorCount === 0 && report.warningCount === 0) {
    lines.push('✓ checks passed')
  } else {
    lines.push(`${report.errorCount} error(s), ${report.warningCount} warning(s)`)
  }

  if (report.suppressedCount) lines.push(`· 行内抑制 ${report.suppressedCount} 条`)
  if (report.baseline) lines.push(`· 基线抵掉 ${report.baseline.suppressed} 条，失效 ${report.baseline.stale} 条`)

  return lines.join('\n')
}

export const formatJson: Formatter = (report) =>
  JSON.stringify(
    {
      version: 1,
      results: report.results,
      skipped: report.skipped,
      summary: {
        errorCount: report.errorCount,
        warningCount: report.warningCount,
        ...(report.suppressedCount === undefined ? {} : { suppressedCount: report.suppressedCount }),
        ...(report.baseline === undefined ? {} : { baseline: report.baseline }),
      },
    },
    null,
    2,
  )

const fingerprint = (ruleId: string, file: string, message: string): string =>
  createHash('sha1').update(`${ruleId}\0${file}\0${message}`).digest('hex')

export const formatSarif: Formatter = (report) => {
  const ruleIds = [
    ...new Set(report.results.flatMap((result) => result.messages.map((message) => message.ruleId))),
  ].sort()

  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'checks',
              version: packageVersion(),
              rules: ruleIds.map((ruleId) => ({
                id: ruleId,
                name: ruleId.split('/').pop() ?? ruleId,
                shortDescription: { text: ruleId },
              })),
            },
          },
          results: report.results.flatMap((result) =>
            result.messages.map((message) => ({
              ruleId: message.ruleId,
              level: message.severity === 2 ? 'error' : 'warning',
              message: { text: message.message },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: result.filePath },
                    region: {
                      startLine: message.line ?? 1,
                      startColumn: message.column ?? 1,
                    },
                  },
                },
              ],
              partialFingerprints: {
                primaryLocationLineHash: fingerprint(message.ruleId, result.filePath, message.message),
              },
            })),
          ),
        },
      ],
    },
    null,
    2,
  )
}

const escapeProperty = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/,/g, '%2C').replace(/:/g, '%3A')

const escapeData = (value: string): string => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

export const formatGithub: Formatter = (report) => {
  const lines: string[] = []
  for (const result of report.results) {
    for (const message of result.messages) {
      const command = message.severity === 2 ? 'error' : 'warning'
      const properties = [
        `file=${escapeProperty(result.filePath)}`,
        `line=${message.line ?? 1}`,
        `col=${message.column ?? 1}`,
        `title=${escapeProperty(message.ruleId)}`,
      ].join(',')
      lines.push(`::${command} ${properties}::${escapeData(message.message)}`)
    }
  }
  return lines.join('\n')
}

const BUILTIN: Record<string, Formatter> = {
  text: formatText,
  json: formatJson,
  sarif: formatSarif,
  github: formatGithub,
}

/** 内置名或模块路径；模块默认导出 `(results, meta) => string`，与 ESLint formatter 同形。 */
export async function resolveFormatter(cwd: string, name: string): Promise<Formatter> {
  const builtin = BUILTIN[name]
  if (builtin) return builtin

  let module: { default?: unknown }
  try {
    module = (await import(pathToFileURL(path.resolve(cwd, name)).href)) as { default?: unknown }
  } catch (error) {
    throw new ChecksError(
      `无法加载 formatter：${name}（${error instanceof Error ? error.message : String(error)}）`,
      'USAGE',
    )
  }
  const fn = module.default
  if (typeof fn !== 'function') throw new ChecksError(`formatter 必须默认导出函数：${name}`, 'USAGE')

  return (report, meta) =>
    String(
      (fn as (results: CheckReport['results'], meta: FormatterMeta) => string)(report.results, {
        ...meta,
        toolVersion: packageVersion(),
      }),
    )
}
