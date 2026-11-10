import fs from 'node:fs'
import path from 'node:path'
import { applyBaseline, readBaseline } from './baseline'
import { ChecksError, loadConfig, rulesForFile } from './config'
import { toReport } from './findings'
import { resolveImport } from './imports'
import { builtinRules } from './rules'
import { expandPatterns, toPosix } from './scan'
import { applySuppressions } from './suppress'
import type {
  Checker,
  CheckerOptions,
  CheckReport,
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

function createContext(
  cwd: string,
  files: string[],
  overlay: Map<string, string>,
  ignore: string[],
  resolver?: CheckerOptions['resolver'],
): RuleContext {
  const read = (file: string): string => {
    const normalized = toPosix(file)
    const virtual = overlay.get(normalized)
    if (virtual !== undefined) return virtual
    return fs.readFileSync(path.resolve(cwd, normalized), 'utf8')
  }

  const normalize = (resolved: string): string | null => {
    const absolute = path.isAbsolute(resolved) ? resolved : path.resolve(cwd, resolved)
    const relative = toPosix(path.relative(cwd, absolute))
    return relative.startsWith('..') ? null : relative
  }

  return {
    workspaceRoot: cwd,
    root: cwd,
    files,
    read,
    exists: (file) => overlay.has(toPosix(file)) || fs.existsSync(path.resolve(cwd, file)),
    glob: (patterns) => expandPatterns({ cwd, patterns, ignore }),
    resolve: async (specifier, importer) => {
      if (resolver) {
        const resolved = await resolver(specifier, importer)
        if (resolved) return normalize(resolved)
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
      }
      return resolveImport(cwd, importer, specifier)
    },
  }
}

export async function createChecker(options: CheckerOptions = {}): Promise<Checker> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const config = await loadConfig({ cwd, config: options.config })
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
      const context = createContext(cwd, group.files, overlay, config.ignore ?? [], options.resolver)

      for (const ruleConfig of group.rules) {
        if (signal?.aborted) throw signal.reason ?? new Error('aborted')

        const rule = builtinRules[ruleConfig.use]
        if (!rule) throw new ChecksError(`未知规则：${ruleConfig.use}`, 'CONFIG')

        const ruleId = `checks/${rule.name}`
        let produced: Finding[]
        try {
          produced = await withTimeout(
            Promise.resolve(rule.run(context, ruleConfig.options ?? {})),
            ruleConfig.timeout ?? DEFAULT_TIMEOUT,
            ruleId,
          )
        } catch (error) {
          if (error instanceof ChecksError) throw error
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

    const suppression = applySuppressions(cwd, files, findings, (file) => {
      const virtual = overlay.get(file)
      if (virtual !== undefined) return virtual
      return fs.readFileSync(path.resolve(cwd, file), 'utf8')
    })
    let kept = suppression.findings
    let baselineInfo: CheckReport['baseline']

    if (runOptions.baseline !== false && baselineFile) {
      const data = readBaseline(cwd, baselineFile)
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
    getConfig: () => config,

    async lintFiles(patterns, runOptions = {}) {
      const inputs = patterns && patterns.length > 0 ? patterns : (config.roots ?? ['.'])
      const expanded = expandPatterns({ cwd, patterns: inputs, ignore: config.ignore ?? [] })
      const only = runOptions.onlyFiles ? new Set(runOptions.onlyFiles) : null
      const files = only ? expanded.filter((file) => only.has(file)) : expanded
      return run(
        files.map((file) => ({ file })),
        runOptions,
      )
    },

    async lintText(code, runOptions) {
      const absolute = path.resolve(cwd, runOptions.filePath)
      const relative = toPosix(path.relative(cwd, absolute))
      if (!relative || relative.startsWith('..')) {
        throw new ChecksError('filePath 必须位于 cwd 内', 'USAGE')
      }
      return run([{ file: relative, code }], runOptions)
    },
  }
}
