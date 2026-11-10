import { extname } from 'node:path'
import { ChecksError } from '../config'
import { matchGlob } from '../glob'
import { maskText } from '../mask'
import { positionAt } from '../position'
import type { Finding, Rule, Severity, TextPattern, TextRuleOptions } from '../types'

const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.vue',
])
const DOC_EXT = /\.(md|mdx)$/i
const INCLUDES = new Set<NonNullable<TextRuleOptions['include']>>(['all', 'code', 'comments', 'docs'])

interface Matcher {
  regex: RegExp
  level: Severity
  message?: string
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError(`text.${field} 必须是字符串数组`, 'CONFIG')
  }
  return value as string[]
}

function asPatterns(value: unknown, field: string): Array<string | TextPattern> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ChecksError(`text.${field} 必须是数组`, 'CONFIG')
  return value.map((entry, index) => {
    if (typeof entry === 'string') return entry
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ChecksError(`text.${field}[${index}] 必须是字符串或对象`, 'CONFIG')
    }
    const pattern = entry as Record<string, unknown>
    if (typeof pattern.pattern !== 'string' || pattern.pattern.length === 0) {
      throw new ChecksError(`text.${field}[${index}].pattern 必须是非空字符串`, 'CONFIG')
    }
    return {
      pattern: pattern.pattern,
      ...(typeof pattern.flags === 'string' ? { flags: pattern.flags } : {}),
      ...(typeof pattern.message === 'string' ? { message: pattern.message } : {}),
    }
  })
}

function parseOptions(input: Record<string, unknown>): TextRuleOptions {
  const include = (input.include ?? 'all') as NonNullable<TextRuleOptions['include']>
  if (!INCLUDES.has(include)) {
    throw new ChecksError('text.include 只能是 all / code / comments / docs', 'CONFIG')
  }
  const scope = asStringArray(input.scope, 'scope')
  const deny = asPatterns(input.deny, 'deny')
  const warn = asPatterns(input.warn, 'warn')
  const accept = asStringArray(input.accept, 'accept')
  return {
    include,
    ...(scope ? { scope } : {}),
    ...(deny ? { deny } : {}),
    ...(warn ? { warn } : {}),
    ...(accept ? { accept } : {}),
  }
}

function toMatcher(entry: string | TextPattern, level: Severity, field: string): Matcher {
  const pattern = typeof entry === 'string' ? entry : entry.pattern
  const flags = typeof entry === 'string' ? 'g' : (entry.flags ?? 'g')
  try {
    return {
      regex: new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`),
      level,
      ...(typeof entry === 'string' || entry.message === undefined ? {} : { message: entry.message }),
    }
  } catch (error) {
    throw new ChecksError(
      `text.${field} 的正则无效：${error instanceof Error ? error.message : String(error)}`,
      'CONFIG',
    )
  }
}

function isAccepted(text: string, index: number, accept: RegExp[]): boolean {
  if (accept.length === 0) return false
  const start = text.lastIndexOf('\n', index - 1) + 1
  const end = text.indexOf('\n', index)
  const line = text.slice(start, end === -1 ? undefined : end)
  return accept.some((pattern) => pattern.test(line))
}

function includeFile(file: string, include: NonNullable<TextRuleOptions['include']>): boolean {
  if (include === 'all') return true
  if (include === 'docs') return DOC_EXT.test(file)
  return CODE_EXT.has(extname(file).toLowerCase())
}

export const textRule: Rule = {
  name: 'text',
  description: '按词表 / 正则扫描文本，支持 scope、include 与 accept 白名单',
  run(ctx, rawOptions) {
    const options = parseOptions(rawOptions)
    const matchers = [
      ...(options.deny ?? []).map((entry) => toMatcher(entry, 'error', 'deny')),
      ...(options.warn ?? []).map((entry) => toMatcher(entry, 'warn', 'warn')),
    ]
    if (matchers.length === 0) return []

    const accept = (options.accept ?? []).map((pattern) => {
      try {
        return new RegExp(pattern)
      } catch (error) {
        throw new ChecksError(
          `text.accept 的正则无效：${error instanceof Error ? error.message : String(error)}`,
          'CONFIG',
        )
      }
    })

    const scope = options.scope ?? []
    const findings: Finding[] = []

    for (const file of ctx.files) {
      if (scope.length > 0 && !scope.some((pattern) => matchGlob(pattern, file))) continue
      if (!includeFile(file, options.include ?? 'all')) continue

      const text = maskText(ctx.read(file), file, options.include ?? 'all')

      for (const matcher of matchers) {
        matcher.regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = matcher.regex.exec(text)) !== null) {
          if (match[0].length === 0) {
            matcher.regex.lastIndex++
            continue
          }
          if (isAccepted(text, match.index, accept)) continue
          const position = positionAt(text, match.index)
          findings.push({
            ruleId: 'checks/text',
            level: matcher.level,
            file,
            line: position.line,
            column: position.column,
            message: matcher.message ?? `禁止出现：${match[0]}`,
            hint: '删除或改写该片段',
          })
        }
      }
    }

    return findings
  },
}
