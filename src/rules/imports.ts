import fs from 'node:fs'
import path from 'node:path'
import { ChecksError } from '../config'
import { matchGlob } from '../glob'
import { extractImports, isRelativeSpecifier, packageNameOf } from '../imports'
import { toPosix } from '../scan'
import type { Finding, Rule } from '../types'

interface ForbidEntry {
  regex: RegExp
  scope?: string[]
  message?: string
}

interface Options {
  packageRoots: string[]
  packages: string[]
  forbid: ForbidEntry[]
  internalSrc: boolean
  requireDeclared: boolean
}

interface Owner {
  root: string
  name?: string
  declared: Set<string>
}

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']

const asStringArray = (value: unknown, field: string): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError(`imports.${field} 必须是字符串数组`, 'CONFIG')
  }
  return value as string[]
}

const asBoolean = (value: unknown, field: string, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ChecksError(`imports.${field} 必须是布尔值`, 'CONFIG')
  return value
}

function parseForbid(value: unknown): ForbidEntry[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ChecksError('imports.forbid 必须是数组', 'CONFIG')
  return value.map((entry, index) => {
    if (typeof entry === 'string') return { regex: compile(entry, index) }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ChecksError(`imports.forbid[${index}] 必须是字符串或对象`, 'CONFIG')
    }
    const record = entry as Record<string, unknown>
    if (typeof record.pattern !== 'string' || record.pattern.length === 0) {
      throw new ChecksError(`imports.forbid[${index}].pattern 必须是非空字符串`, 'CONFIG')
    }
    const scope = asStringArray(record.scope, `forbid[${index}].scope`)
    return {
      regex: compile(record.pattern, index),
      ...(scope ? { scope } : {}),
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    }
  })
}

function compile(pattern: string, index: number): RegExp {
  try {
    return new RegExp(pattern)
  } catch (error) {
    throw new ChecksError(
      `imports.forbid[${index}] 的正则无效：${error instanceof Error ? error.message : String(error)}`,
      'CONFIG',
    )
  }
}

function parseOptions(input: Record<string, unknown>): Options {
  const packages = asStringArray(input.packages, 'packages') ?? []
  return {
    packageRoots: asStringArray(input.packageRoots, 'packageRoots') ?? [],
    packages,
    forbid: parseForbid(input.forbid),
    internalSrc: asBoolean(input.internalSrc, 'internalSrc', packages.length > 0),
    requireDeclared: asBoolean(input.requireDeclared, 'requireDeclared', packages.length > 0),
  }
}

const inside = (file: string, root: string): boolean => file === root || file.startsWith(`${root}/`)

function readOwner(cwd: string, root: string): Owner {
  let name: string | undefined
  const declared = new Set<string>()

  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(cwd, root, 'package.json'), 'utf8')) as Record<string, unknown>
    if (typeof pkg.name === 'string') name = pkg.name
    for (const field of DEP_FIELDS) {
      const value = pkg[field]
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      for (const dependency of Object.keys(value)) declared.add(dependency)
    }
  } catch {
    /* 没有 package.json 时只做边界检查 */
  }

  return { root, ...(name ? { name } : {}), declared }
}

function ownerFor(cwd: string, file: string, roots: string[], cache: Map<string, Owner>): Owner | undefined {
  const root = roots
    .map((candidate) => toPosix(path.relative(cwd, path.resolve(cwd, candidate))))
    .filter((candidate) => candidate && !candidate.startsWith('..') && inside(file, candidate))
    .sort((left, right) => right.length - left.length)[0]

  if (!root) return undefined
  const cached = cache.get(root)
  if (cached) return cached
  const owner = readOwner(cwd, root)
  cache.set(root, owner)
  return owner
}

export const importsRule: Rule = {
  name: 'imports',
  description: '检查相对路径边界、禁止的说明符与内部包依赖声明',
  async run(ctx, rawOptions) {
    const options = parseOptions(rawOptions)
    const ownerCache = new Map<string, Owner>()
    const findings: Finding[] = []

    for (const file of ctx.files) {
      const refs = extractImports(ctx.read(file), file)
      if (refs.length === 0) continue
      const owner = ownerFor(ctx.workspaceRoot, file, options.packageRoots, ownerCache)

      for (const ref of refs) {
        const forbidden = options.forbid.find((entry) => {
          if (entry.scope && entry.scope.length > 0 && !entry.scope.some((scope) => matchGlob(scope, file))) {
            return false
          }
          entry.regex.lastIndex = 0
          return entry.regex.test(ref.specifier)
        })

        if (forbidden) {
          findings.push({
            ruleId: 'checks/imports',
            level: 'error',
            file,
            line: ref.line,
            column: ref.column,
            message: forbidden.message ?? `禁止引用：${ref.specifier}`,
            hint: '改用允许的入口或补充配置',
          })
          continue
        }

        if (isRelativeSpecifier(ref.specifier)) {
          const resolved = await ctx.resolve(ref.specifier, file)
          if (!resolved) continue
          if (resolved.startsWith('..') || (owner && !inside(resolved, owner.root))) {
            findings.push({
              ruleId: 'checks/imports',
              level: 'error',
              file,
              line: ref.line,
              column: ref.column,
              message: `相对路径跨出 ${owner?.root ?? 'workspace'}：${ref.specifier}`,
              hint: '改用包名入口或已发布子路径',
            })
          }
          continue
        }

        const prefix = options.packages.find((candidate) => ref.specifier.startsWith(candidate))
        if (!prefix) continue

        const packageName = packageNameOf(ref.specifier)
        const remainder = ref.specifier.slice(prefix.length)

        if (options.internalSrc && /(^|\/)src(\/|$)/.test(remainder)) {
          findings.push({
            ruleId: 'checks/imports',
            level: 'error',
            file,
            line: ref.line,
            column: ref.column,
            message: `引用上游源码：${ref.specifier}`,
            hint: '改读已发布的入口',
          })
          continue
        }

        if (options.requireDeclared && owner) {
          if (owner.name === packageName || owner.declared.has(packageName)) continue
          findings.push({
            ruleId: 'checks/imports',
            level: 'error',
            file,
            line: ref.line,
            column: ref.column,
            message: `未声明依赖 ${packageName}（${owner.root}/package.json）`,
            hint: '在 package.json 里声明该依赖',
          })
        }
      }
    }

    return findings
  },
}
