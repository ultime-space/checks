import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { matchGlob } from './glob'
import type { ChecksConfig, RuleConfig, Severity } from './types'

export type ErrorCode = 'CONFIG' | 'CONFIG_FIELD' | 'CONFIG_RULE' | 'CONFIG_OPTION' | 'USAGE' | 'RULE'

export class ChecksError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    /** 出错的字段路径，例如 `rules[0].options`；文件级错误为空。 */
    readonly path?: string,
  ) {
    super(message)
    this.name = 'ChecksError'
  }
}

export const defineConfig = <T extends ChecksConfig>(config: T): T => config

const SEVERITIES = new Set<Severity>(['error', 'warn'])

const CONFIG_KEYS = ['$schema', 'workspace', 'roots', 'ignore', 'baseline', 'rules', 'overrides'] as const
const RULE_KEYS = ['use', 'severity', 'options', 'timeout'] as const
const OVERRIDE_KEYS = ['files', 'rules'] as const

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fieldPath = (parent: string, key: string): string => (parent ? `${parent}.${key}` : key)

/** 未知字段直接报错，不静默忽略。 */
function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], parent: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    const field = fieldPath(parent, key)
    throw new ChecksError(`未知字段：${field}（可用：${allowed.join(' / ')}）`, 'CONFIG_FIELD', field)
  }
}

function assertStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError(`${field} 必须是字符串数组`, 'CONFIG_FIELD', field)
  }
  return value as string[]
}

function assertString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChecksError(`${field} 必须是非空字符串`, 'CONFIG_FIELD', field)
  }
  return value
}

function assertRule(input: unknown, field: string): RuleConfig {
  if (!isObject(input)) throw new ChecksError(`${field} 必须是对象`, 'CONFIG_FIELD', field)
  assertKnownKeys(input, RULE_KEYS, field)

  const rule = input as Record<string, unknown>
  if (typeof rule.use !== 'string' || rule.use.length === 0) {
    throw new ChecksError(`${field}.use 必须是非空字符串`, 'CONFIG_FIELD', `${field}.use`)
  }
  if (rule.severity !== undefined && !SEVERITIES.has(rule.severity as Severity)) {
    throw new ChecksError(`${field}.severity 只能是 error / warn`, 'CONFIG_FIELD', `${field}.severity`)
  }
  if (rule.options !== undefined && !isObject(rule.options)) {
    throw new ChecksError(`${field}.options 必须是对象`, 'CONFIG_FIELD', `${field}.options`)
  }
  if (rule.timeout !== undefined && (typeof rule.timeout !== 'number' || rule.timeout <= 0)) {
    throw new ChecksError(`${field}.timeout 必须是正数`, 'CONFIG_FIELD', `${field}.timeout`)
  }
  return input as unknown as RuleConfig
}

export function validateConfig(input: unknown): ChecksConfig {
  if (!isObject(input)) throw new ChecksError('配置必须是对象', 'CONFIG_FIELD')

  assertKnownKeys(input, CONFIG_KEYS, '')

  if (input.$schema !== undefined && typeof input.$schema !== 'string') {
    throw new ChecksError('$schema 必须是字符串', 'CONFIG_FIELD', '$schema')
  }

  const workspace = assertString(input.workspace, 'workspace')
  const baseline = assertString(input.baseline, 'baseline')
  const roots = assertStringArray(input.roots, 'roots')
  const ignore = assertStringArray(input.ignore, 'ignore')

  const rules =
    input.rules === undefined
      ? []
      : Array.isArray(input.rules)
        ? input.rules.map((rule, index) => assertRule(rule, `rules[${index}]`))
        : (() => {
            throw new ChecksError('rules 必须是数组', 'CONFIG_FIELD', 'rules')
          })()

  const normalizedOverrides: ChecksConfig['overrides'] = Array.isArray(input.overrides)
    ? input.overrides.map((entry, index) => {
        const field = `overrides[${index}]`
        if (!isObject(entry)) throw new ChecksError(`${field} 必须是对象`, 'CONFIG_FIELD', field)
        assertKnownKeys(entry, OVERRIDE_KEYS, field)

        const files = assertStringArray(entry.files, `${field}.files`)
        if (!files || files.length === 0) {
          throw new ChecksError(`${field}.files 不能为空`, 'CONFIG_FIELD', `${field}.files`)
        }
        const rules = Array.isArray(entry.rules)
          ? entry.rules.map((rule, ruleIndex) => assertRule(rule, `${field}.rules[${ruleIndex}]`))
          : (() => {
              throw new ChecksError(`${field}.rules 必须是数组`, 'CONFIG_FIELD', `${field}.rules`)
            })()
        return { files, rules }
      })
    : undefined

  return {
    ...(workspace ? { workspace } : {}),
    ...(roots ? { roots } : {}),
    ...(ignore ? { ignore } : {}),
    ...(baseline ? { baseline } : {}),
    rules,
    ...(normalizedOverrides ? { overrides: normalizedOverrides } : {}),
  }
}

/**
 * 解析 workspace 根：配置写了 `workspace` 就以它为检测根，否则沿用 cwd。
 * roots / ignore / overrides / baseline 与结果路径都相对这个根。
 */
export function resolveWorkspaceRoot(cwd: string, config: ChecksConfig): string {
  if (config.workspace === undefined) return cwd

  const root = path.resolve(cwd, config.workspace)
  let stat: fs.Stats
  try {
    stat = fs.statSync(root)
  } catch {
    throw new ChecksError(`workspace 目录不存在：${config.workspace}`, 'CONFIG_FIELD', 'workspace')
  }
  if (!stat.isDirectory()) {
    throw new ChecksError(`workspace 必须是目录：${config.workspace}`, 'CONFIG_FIELD', 'workspace')
  }
  return root
}

export async function loadConfig(options: { cwd: string; config?: string | ChecksConfig }): Promise<ChecksConfig> {
  if (options.config && typeof options.config === 'object') return validateConfig(options.config)

  const file = path.resolve(options.cwd, options.config ?? 'checks.config.mjs')
  if (!fs.existsSync(file)) {
    throw new ChecksError(`找不到配置文件：${path.relative(options.cwd, file) || file}`, 'CONFIG')
  }

  const module = (await import(pathToFileURL(file).href)) as { default?: unknown }
  return validateConfig(module.default)
}

/** 先取基础规则，再用命中的 overrides 覆盖同名规则。 */
export function rulesForFile(config: ChecksConfig, file: string): RuleConfig[] {
  const rules = (config.rules ?? []).map((rule) => ({ ...rule }))
  for (const override of config.overrides ?? []) {
    if (!override.files.some((pattern) => matchGlob(pattern, file))) continue
    for (const rule of override.rules) {
      const index = rules.findIndex((item) => item.use === rule.use)
      if (index === -1) rules.push({ ...rule })
      else rules[index] = { ...rules[index], ...rule, options: { ...rules[index]?.options, ...rule.options } }
    }
  }
  return rules
}
