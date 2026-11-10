import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { matchGlob } from './glob'
import type { ChecksConfig, RuleConfig, Severity } from './types'

export type ErrorCode = 'CONFIG' | 'USAGE' | 'RULE'

export class ChecksError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message)
    this.name = 'ChecksError'
  }
}

export const defineConfig = <T extends ChecksConfig>(config: T): T => config

const SEVERITIES = new Set<Severity>(['error', 'warn'])

function assertStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError(`${field} 必须是字符串数组`, 'CONFIG')
  }
  return value as string[]
}

function assertRule(input: unknown, index: number): RuleConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ChecksError(`rules[${index}] 必须是对象`, 'CONFIG')
  }
  const rule = input as Record<string, unknown>
  if (typeof rule.use !== 'string' || rule.use.length === 0) {
    throw new ChecksError(`rules[${index}].use 必须是非空字符串`, 'CONFIG')
  }
  if (rule.severity !== undefined && !SEVERITIES.has(rule.severity as Severity)) {
    throw new ChecksError(`rules[${index}].severity 只能是 error / warn`, 'CONFIG')
  }
  if (
    rule.options !== undefined &&
    (typeof rule.options !== 'object' || rule.options === null || Array.isArray(rule.options))
  ) {
    throw new ChecksError(`rules[${index}].options 必须是对象`, 'CONFIG')
  }
  if (rule.timeout !== undefined && (typeof rule.timeout !== 'number' || rule.timeout <= 0)) {
    throw new ChecksError(`rules[${index}].timeout 必须是正数`, 'CONFIG')
  }
  return input as RuleConfig
}

export function validateConfig(input: unknown): ChecksConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ChecksError('配置必须是对象', 'CONFIG')
  }

  const config = input as Record<string, unknown>
  const roots = assertStringArray(config.roots, 'roots')
  const ignore = assertStringArray(config.ignore, 'ignore')

  const rules =
    config.rules === undefined
      ? []
      : Array.isArray(config.rules)
        ? config.rules.map(assertRule)
        : (() => {
            throw new ChecksError('rules 必须是数组', 'CONFIG')
          })()

  const normalizedOverrides: ChecksConfig['overrides'] = Array.isArray(config.overrides)
    ? config.overrides.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new ChecksError(`overrides[${index}] 必须是对象`, 'CONFIG')
        }
        const value = entry as Record<string, unknown>
        const files = assertStringArray(value.files, `overrides[${index}].files`)
        if (!files || files.length === 0) throw new ChecksError(`overrides[${index}].files 不能为空`, 'CONFIG')
        const rules = Array.isArray(value.rules)
          ? value.rules.map(assertRule)
          : (() => {
              throw new ChecksError(`overrides[${index}].rules 必须是数组`, 'CONFIG')
            })()
        return { files, rules }
      })
    : undefined

  return {
    ...(typeof config.workspace === 'string' ? { workspace: config.workspace } : {}),
    ...(roots ? { roots } : {}),
    ...(ignore ? { ignore } : {}),
    ...(typeof config.baseline === 'string' ? { baseline: config.baseline } : {}),
    rules,
    ...(normalizedOverrides ? { overrides: normalizedOverrides } : {}),
  }
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
