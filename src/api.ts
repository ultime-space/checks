import fs from 'node:fs'
import path from 'node:path'
import { applyBaseline, readBaseline } from './baseline'
import { ChecksError, loadConfig, resolveWorkspaceRoot, rulesForFile } from './config'
import { toReport } from './findings'
import { resolveImport } from './imports'
import { builtinRules } from './rules'
import { expandPatterns, toPosix } from './scan'
import { applySuppressions } from './suppress'
import type {
  Checker,
  CheckerOptions,
  CheckReport,
  ChecksConfig,
  Finding,
  RuleConfig,
  RuleContext,
  RunOptions,
  SkippedRule,
} from './types'

const DEFAULT_TIMEOUT = 120_000

interface Entry {
  file: string
  code?: string
}

function withTimeout<T>(task: Promise<T>, timeout: number, ruleId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ChecksError(`规则超时：${ruleId}`, 'RULE')), timeout)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** 未知规则在创建检查器时就失败，不等到第一个文件才报。 */
function assertKnownRules(config: ChecksConfig): void {
  const groups: Array<{ rules: RuleConfig[]; prefix: string }> = [
    { rules: config.rules ?? [], prefix: 'rules' },
    ...(config.overrides ?? []).map((override, index) => ({
      rules: override.rules,
      prefix: `overrides[${index}].rules`,
    })),
  ]

  for (const group of groups) {
    group.rules.forEach((rule, index) => {
      if (builtinRules[rule.use]) return
      throw new ChecksError(
        `未知规则：${rule.use}（可用：${Object.keys(builtinRules).sort().join(' / ')}）`,
        'CONFIG_RULE',
        `${group.prefix}[${index}].use`,
      )
    })
  }
}

/** 规则在运行时才发现 options 非法：回填配置里的规则路径，便于定位。 */
function optionsPath(config: ChecksConfig, use: string): string | undefined {
  const index = config.rules?.findIndex((rule) => rule.use === use) ?? -1
  if (index >= 0) return `rules[${index}].options`

  for (const [overrideIndex, override] of (config.overrides ?? []).entries()) {
    const found = override.rules.findIndex((rule) => rule.use === use)
    if (found >= 0) return `overrides[${overrideIndex}].rules[${found}].options`
  }
  return undefined
}

function createContext(
  root: string,
  files: string[],
  overlay: Map<string, string>,
  ignore: string[],
  resolver?: CheckerOptions['resolver'],
): RuleContext {
  const read = (file: string): string => {
    const normalized = toPosix(file)
    const virtual = overlay.get(normalized)
    if (virtual !== undefined) return virtual
    return fs.readFileSync(path.resolve(root, normalized), 'utf8')
  }

  const normalize = (resolved: string): string | null => {
    const absolute = path.isAbsolute(resolved) ? resolved : path.resolve(root, resolved)
    const relative = toPosix(path.relative(root, absolute))
    return relative.startsWith('..') ? null : relative
  }

  return {
    workspaceRoot: root,
    root,
    files,
    read,
    exists: (file) => overlay.has(toPosix(file)) || fs.existsSync(path.resolve(root, file)),
    glob: (patterns) => expandPatterns({ cwd: root, patterns, ignore }),
    resolve: async (specifier, importer) => {
      if (resolver) {
        const resolved = await resolver(specifier, importer)
        if (resolved) return normalize(resolved)
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
      }
      return resolveImport(root, importer, specifier)
    },
  }
}

export async function createChecker(options: CheckerOptions = {}): Promise<Checker> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const config = await loadConfig({ cwd, config: options.config })
  assertKnownRules(config)

  const root = resolveWorkspaceRoot(cwd, config)
  const baselineFile =
    options.baseline === false ? null : (options.baseline ?? config.baseline ?? '.checks-baseline.json')

  const run = async (entries: Entry[], runOptions: RunOptions = {}): Promise<CheckReport> => {
    const signal = runOptions.signal
    const files = entries.map((entry) => entry.file)
    const overlay = new Map<string, string>()
    for (const entry of entries) {
      if (entry.code !== undefined) overlay.set(entry.file, entry.code)
    }

    const groups = new Map<string, { rules: RuleConfig[]; files: string[] }>()
    for (const file of files) {
      const rules = rulesForFile(config, file)
      const key = JSON.stringify(rules)
      const group = groups.get(key) ?? { rules, files: [] }
      group.files.push(file)
      groups.set(key, group)
    }

    const findings: Finding[] = []
    const skipped: SkippedRule[] = []

    for (const group of groups.values()) {
      const context = createContext(root, group.files, overlay, config.ignore ?? [], options.resolver)

      for (const ruleConfig of group.rules) {
        if (signal?.aborted) throw signal.reason ?? new Error('aborted')

        const rule = builtinRules[ruleConfig.use]
        if (!rule) throw new ChecksError(`未知规则：${ruleConfig.use}`, 'CONFIG_RULE')

        const ruleId = `checks/${rule.name}`
        let produced: Finding[]
        try {
          produced = await withTimeout(
            Promise.resolve(rule.run(context, ruleConfig.options ?? {})),
            ruleConfig.timeout ?? DEFAULT_TIMEOUT,
            ruleId,
          )
        } catch (error) {
          if (error instanceof ChecksError) {
            if (error.code !== 'CONFIG' && error.code !== 'CONFIG_OPTION') throw error
            throw new ChecksError(error.message, 'CONFIG_OPTION', error.path ?? optionsPath(config, ruleConfig.use))
          }
          throw new ChecksError(
            `规则执行失败：${ruleId}（${error instanceof Error ? error.message : String(error)}）`,
            'RULE',
          )
        }

        findings.push(
          ...produced.map((finding) => ({
            ...finding,
            level: finding.locked ? finding.level : (ruleConfig.severity ?? finding.level),
          })),
        )
      }
    }

    const suppression = applySuppressions(root, files, findings, (file) => {
      const virtual = overlay.get(file)
      if (virtual !== undefined) return virtual
      return fs.readFileSync(path.resolve(root, file), 'utf8')
    })
    let kept = suppression.findings
    let baselineInfo: CheckReport['baseline']

    if (runOptions.baseline !== false && baselineFile) {
      const data = readBaseline(root, baselineFile)
      if (data) {
        const applied = applyBaseline(kept, data)
        kept = applied.findings
        baselineInfo = { suppressed: applied.suppressed, stale: applied.stale }
      }
    }

    const report = toReport([...kept, ...suppression.diagnostics])
    return {
      ...report,
      skipped,
      suppressedCount: suppression.suppressed,
      ...(baselineInfo ? { baseline: baselineInfo } : {}),
    }
  }

  return {
    workspaceRoot: root,
    getConfig: () => config,

    async lintFiles(patterns, runOptions = {}) {
      const inputs = patterns && patterns.length > 0 ? patterns : (config.roots ?? ['.'])
      const expanded = expandPatterns({ cwd: root, patterns: inputs, ignore: config.ignore ?? [] })
      const only = runOptions.onlyFiles ? new Set(runOptions.onlyFiles) : null
      const files = only ? expanded.filter((file) => only.has(file)) : expanded
      return run(
        files.map((file) => ({ file })),
        runOptions,
      )
    },

    async lintText(code, runOptions) {
      const absolute = path.resolve(root, runOptions.filePath)
      const relative = toPosix(path.relative(root, absolute))
      if (!relative || relative.startsWith('..')) {
        throw new ChecksError('filePath 必须位于工作根内', 'USAGE')
      }
      return run([{ file: relative, code }], runOptions)
    },
  }
}
