import { ChecksError } from '../config'
import { matchGlob } from '../glob'
import { extractImports, isRelativeSpecifier } from '../imports'
import type { Finding, Rule } from '../types'

const asScope = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError('unresolved.scope 必须是字符串数组', 'CONFIG')
  }
  return value as string[]
}

const asIgnore = (value: unknown): RegExp[] => {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError('unresolved.ignore 必须是字符串数组', 'CONFIG')
  }
  return (value as string[]).map((pattern) => {
    try {
      return new RegExp(pattern)
    } catch (error) {
      throw new ChecksError(
        `unresolved.ignore 的正则无效：${error instanceof Error ? error.message : String(error)}`,
        'CONFIG',
      )
    }
  })
}

export const unresolvedRule: Rule = {
  name: 'unresolved',
  description: '报告无法解析的相对引用，避免解析失败被当成没有违规',
  async run(ctx, rawOptions) {
    const scope = asScope(rawOptions.scope) ?? []
    const ignore = asIgnore(rawOptions.ignore)
    const findings: Finding[] = []

    for (const file of ctx.files) {
      if (scope.length > 0 && !scope.some((pattern) => matchGlob(pattern, file))) continue
      const refs = extractImports(ctx.read(file), file)
      for (const ref of refs) {
        if (!isRelativeSpecifier(ref.specifier)) continue
        if (ignore.some((pattern) => pattern.test(ref.specifier))) continue
        if (await ctx.resolve(ref.specifier, file)) continue
        findings.push({
          ruleId: 'checks/unresolved',
          level: 'warn',
          locked: true,
          file,
          line: ref.line,
          column: ref.column,
          message: `无法解析引用：${ref.specifier}`,
          hint: '检查路径、扩展名，或由宿主注入 resolver',
        })
      }
    }

    return findings
  },
}
