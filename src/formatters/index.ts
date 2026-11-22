import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { style } from '@ultime/cli'
import { ChecksError } from '../config'
import type { CheckMessage, CheckReport } from '../types'
import { packageVersion } from '../version'

export interface FormatterMeta {
  cwd: string
  maxWarningsExceeded?: boolean
  maxWarnings?: number
  hiddenWarnings?: number
  totalFiles?: number
  color?: boolean
  readSource?: (file: string) => string | undefined
  toolVersion?: string
}

export type Formatter = (report: CheckReport, meta: FormatterMeta) => string

const MAX_FRAME_WIDTH = 120
const TAB_WIDTH = 2
const CONTEXT_LINES = 1

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code === 0x200d) return 0
  if (code >= 0x0300 && code <= 0x036f) return 0
  if (code >= 0x200b && code <= 0x200f) return 0
  if (code >= 0xfe00 && code <= 0xfe0f) return 0
  if (code >= 0x20d0 && code <= 0x20ff) return 0
  if (code >= 0x1100 && code <= 0x115f) return 2
  if (code >= 0x2e80 && code <= 0xa4cf) return 2
  if (code >= 0xac00 && code <= 0xd7a3) return 2
  if (code >= 0xf900 && code <= 0xfaff) return 2
  if (code >= 0xfe10 && code <= 0xfe19) return 2
  if (code >= 0xfe30 && code <= 0xfe6f) return 2
  if (code >= 0xff00 && code <= 0xff60) return 2
  if (code >= 0xffe0 && code <= 0xffe6) return 2
  if (code >= 0x1f300 && code <= 0x1faff) return 2
  if (code >= 0x20000 && code <= 0x3fffd) return 2
  return 1
}

function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char)
  return width
}

function expandTabs(text: string): string {
  return text.replace(/\t/g, ' '.repeat(TAB_WIDTH))
}

function clipLine(text: string, max: number): { text: string; width: number } {
  let result = ''
  let width = 0
  for (const char of text) {
    const next = charWidth(char)
    if (width + next > max - 1) return { text: `${result}…`, width: width + 1 }
    result += char
    width += next
  }
  return { text: result, width }
}

/** 只在有源码时渲染；`--stdin`、文件缺失或超限由 readSource 返回 undefined。 */
function renderFrame(message: CheckMessage, source: string, color: boolean | undefined): string[] {
  if (message.line === undefined) return []

  const lines = source.split(/\r\n|[\n\r\u2028\u2029]/)
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0) return []

  const start = Math.max(1, message.line - CONTEXT_LINES)
  const end = Math.min(lines.length, (message.endLine ?? message.line) + CONTEXT_LINES)
  const gutter = String(end).length
  const output: string[] = []

  for (let lineNo = start; lineNo <= end; lineNo += 1) {
    const raw = expandTabs(lines[lineNo - 1] ?? '')
    const clipped = clipLine(raw, MAX_FRAME_WIDTH)
    output.push(`      ${String(lineNo).padStart(gutter)} ${style(color, 'dim', '│')} ${clipped.text}`)

    if (lineNo !== message.line) continue

    const chars = Array.from(raw)
    const column = Math.max(1, message.column ?? 1)
    const startWidth = displayWidth(chars.slice(0, column - 1).join(''))
    const span =
      message.endColumn === undefined
        ? (chars[column - 1] ?? ' ')
        : chars.slice(column - 1, Math.max(column, message.endColumn - 1)).join('')
    const spanWidth = Math.max(1, displayWidth(span || ' '))

    if (startWidth < clipped.width) {
      const carets = '^'.repeat(Math.min(spanWidth, MAX_FRAME_WIDTH - startWidth))
      output.push(`      ${' '.repeat(gutter)} ${style(color, 'dim', '│')} ${' '.repeat(startWidth)}${carets}`)
    }
  }

  return output
}

export const formatText: Formatter = (report, meta) => {
  const lines: string[] = []
  const explained = new Set<string>()

  for (const result of report.results) {
    if (result.messages.length === 0) continue
    lines.push(result.filePath)
    for (const message of result.messages) {
      const level = message.severity === 2 ? 'error' : 'warn'
      const position = `${message.line ?? 0}:${message.column ?? 1}`
      const levelText = style(meta.color, message.severity === 2 ? 'red' : 'yellow', level)
      lines.push(`  ${position}  ${levelText}  ${message.ruleId}  ${message.message}`)
      if (message.hint) lines.push(`           ${style(meta.color, 'dim', 'hint:')} ${message.hint}`)

      const source = meta.readSource?.(result.filePath)
      if (source) lines.push(...renderFrame(message, source, meta.color))

      if (message.ruleId.startsWith('checks/') && !explained.has(message.ruleId)) {
        explained.add(message.ruleId)
        lines.push(`    ${style(meta.color, 'dim', '· 规则说明：')}ultime-checks explain ${message.ruleId}`)
      }
    }
    lines.push('')
  }

  if (report.suppressedCount) lines.push(`· 行内抑制 ${report.suppressedCount} 条`)
  if (report.baseline) lines.push(`· 基线抵掉 ${report.baseline.suppressed} 条，失效 ${report.baseline.stale} 条`)
  if (meta.hiddenWarnings) lines.push(`· --quiet 隐藏 ${meta.hiddenWarnings} 条 warning`)

  if (meta.maxWarningsExceeded) {
    const total = report.warningCount + (meta.hiddenWarnings ?? 0)
    lines.push(`⚠ warning 超预算：${total} > --max-warnings ${meta.maxWarnings ?? '?'}`)
  }

  const totalWarnings = report.warningCount + (meta.hiddenWarnings ?? 0)
  const files = meta.totalFiles ?? report.results.length
  if (report.errorCount === 0 && totalWarnings === 0 && !meta.maxWarningsExceeded) {
    lines.push('✓ checks passed')
  } else {
    lines.push(`${files} 个文件命中 / ${report.errorCount} error / ${totalWarnings} warnings`)
  }

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
