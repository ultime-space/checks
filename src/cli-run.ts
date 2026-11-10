import fs from 'node:fs'
import path from 'node:path'
import { createChecker } from './api'
import { pruneBaseline, updateBaseline } from './baseline'
import { ChecksError } from './config'
import { resolveFormatter } from './formatters'
import { changedFiles } from './git'
import { builtinRules, ruleList } from './rules'
import type { CheckReport } from './types'
import { packageVersion } from './version'

const VALUE_FLAGS = new Set([
  'config',
  'cwd',
  'format',
  'output-file',
  'max-warnings',
  'rule',
  'ignore-rule',
  'stdin-filename',
  'baseline',
  'since',
])

const BOOLEAN_FLAGS = new Set(['stdin', 'quiet', 'json', 'update-baseline', 'prune-baseline', 'changed'])

const HELP = `checks —— 仓库约束检测

用法：
  checks [run] [files...] [options]    运行检查（默认命令）
  checks rules [--json]                列出内置规则
  checks explain <rule>                查看规则文档
  checks --help | --version

选项：
  --config <path>            配置文件，默认 checks.config.mjs
  --cwd <dir>                工作目录，默认当前目录
  --format <text|json|sarif|github|模块>  输出格式，默认 text
  --output-file <path>       把结果写入文件
  --max-warnings <n>         warning 超过 n 时以 1 退出
  --quiet                    只显示 error
  --stdin                    从 stdin 读取内容，需配 --stdin-filename
  --stdin-filename <path>    stdin 内容对应的文件路径
  --rule <name>              只报告指定规则（仍执行全部规则）
  --ignore-rule <name>       从报告中排除指定规则
  --baseline <path>          基线文件，默认 .checks-baseline.json
  --update-baseline          用当前结果重写基线（CI 不允许）
  --prune-baseline           只收缩已有基线条目
  --changed                  只检查工作区改动
  --since <ref>              只检查 ref 之后的改动

退出码：0 通过 / 1 有 error 或 warning 超预算 / 2 配置、用法或规则执行失败`

export interface CliIo {
  cwd?: string
  out(line: string): void
  err(line: string): void
  stdin?(): string
}

type Command = 'run' | 'rules' | 'explain' | 'help' | 'version'

interface ParsedArgs {
  command: Command
  files: string[]
  values: Map<string, string>
  booleans: Set<string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv]
  const values = new Map<string, string>()
  const booleans = new Set<string>()
  const files: string[] = []

  let command: Command = 'run'
  const first = args[0]
  if (first === 'run' || first === 'rules' || first === 'explain' || first === 'help' || first === 'version') {
    command = first
    args.shift()
  }

  let literal = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === undefined) continue
    if (literal) {
      files.push(arg)
      continue
    }
    if (arg === '--') {
      literal = true
      continue
    }
    if (arg === '-h' || arg === '--help') {
      command = 'help'
      continue
    }
    if (arg === '-v' || arg === '--version') {
      command = 'version'
      continue
    }
    if (!arg.startsWith('--')) {
      if (arg.startsWith('-')) throw new ChecksError(`未知参数：${arg}`, 'USAGE')
      files.push(arg)
      continue
    }

    const body = arg.slice(2)
    const separator = body.indexOf('=')
    const key = separator === -1 ? body : body.slice(0, separator)
    const inline = separator === -1 ? undefined : body.slice(separator + 1)

    if (VALUE_FLAGS.has(key)) {
      const value = inline ?? args[++index]
      if (value === undefined) throw new ChecksError(`--${key} 缺少值`, 'USAGE')
      values.set(key, value)
      continue
    }
    if (BOOLEAN_FLAGS.has(key)) {
      if (inline !== undefined) throw new ChecksError(`--${key} 不接受值`, 'USAGE')
      booleans.add(key)
      continue
    }
    throw new ChecksError(`未知参数：--${key}`, 'USAGE')
  }

  return { command, files, values, booleans }
}

const normalizeRuleId = (value: string): string => (value.startsWith('checks/') ? value : `checks/${value}`)

function filterReport(report: CheckReport, keep: (ruleId: string, severity: 1 | 2) => boolean): CheckReport {
  const results = report.results
    .map((result) => {
      const messages = result.messages.filter((message) => keep(message.ruleId, message.severity))
      return {
        ...result,
        messages,
        errorCount: messages.filter((message) => message.severity === 2).length,
        warningCount: messages.filter((message) => message.severity === 1).length,
      }
    })
    .filter((result) => result.messages.length > 0)

  return {
    ...report,
    results,
    errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
    warningCount: results.reduce((sum, result) => sum + result.warningCount, 0),
  }
}

async function execute(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv)

  if (parsed.command === 'help') {
    io.out(HELP)
    return 0
  }
  if (parsed.command === 'version') {
    io.out(packageVersion())
    return 0
  }
  if (parsed.command === 'rules') {
    if (parsed.booleans.has('json')) {
      io.out(
        JSON.stringify(
          ruleList().map((rule) => ({ id: `checks/${rule.name}`, description: rule.description })),
          null,
          2,
        ),
      )
      return 0
    }
    for (const rule of ruleList()) io.out(`checks/${rule.name}  ${rule.description}`)
    return 0
  }
  if (parsed.command === 'explain') {
    const name = parsed.files[0]
    if (!name) throw new ChecksError('用法：checks explain <rule>', 'USAGE')
    const rule = builtinRules[name] ?? builtinRules[normalizeRuleId(name).slice('checks/'.length)]
    if (!rule) throw new ChecksError(`未知规则：${name}`, 'USAGE')
    const file = new URL(`../docs/rules/${rule.name}.md`, import.meta.url)
    if (!fs.existsSync(file)) throw new ChecksError(`缺少规则文档：docs/rules/${rule.name}.md`, 'USAGE')
    io.out(fs.readFileSync(file, 'utf8').trimEnd())
    return 0
  }

  const cwd = path.resolve(io.cwd ?? process.cwd(), parsed.values.get('cwd') ?? '.')
  const baselinePath = parsed.values.get('baseline')
  const update = parsed.booleans.has('update-baseline')
  const prune = parsed.booleans.has('prune-baseline')
  if (update && prune) throw new ChecksError('--update-baseline 与 --prune-baseline 不能同时使用', 'USAGE')
  if (update && process.env.CI) throw new ChecksError('CI 环境不允许生成基线', 'USAGE')

  const since = parsed.values.get('since')
  const changed = parsed.booleans.has('changed')
  if (since && changed) throw new ChecksError('--since 与 --changed 不能同时使用', 'USAGE')
  if ((since || changed) && (update || prune)) {
    throw new ChecksError('基线操作不能与 --since / --changed 同时使用', 'USAGE')
  }
  const onlyFiles = since || changed ? changedFiles(cwd, since) : undefined

  const checker = await createChecker({
    cwd,
    config: parsed.values.get('config'),
    ...(baselinePath ? { baseline: baselinePath } : {}),
  })

  const useStdin = parsed.booleans.has('stdin')
  const stdinFile = parsed.values.get('stdin-filename')
  if (useStdin && !stdinFile) throw new ChecksError('--stdin 需要同时指定 --stdin-filename', 'USAGE')

  const runOptions = { baseline: !update && !prune, ...(onlyFiles ? { onlyFiles } : {}) }
  const report = useStdin
    ? await checker.lintText(io.stdin ? io.stdin() : fs.readFileSync(0, 'utf8'), {
        filePath: stdinFile ?? '',
        ...runOptions,
      })
    : await checker.lintFiles(parsed.files.length > 0 ? parsed.files : undefined, runOptions)

  const baselineFile = baselinePath ?? checker.getConfig().baseline ?? '.checks-baseline.json'
  if (update || prune) {
    if (update) updateBaseline(cwd, baselineFile, report)
    else pruneBaseline(cwd, baselineFile, report)
    io.err(`✓ 基线已${update ? '更新' : '收缩'}：${baselineFile}`)
    return 0
  }

  if (report.baseline?.stale) {
    io.err(`⚠ 基线条目已失效：${report.baseline.stale} 条，运行 --prune-baseline 收缩`)
  }
  if (report.suppressedCount) io.err(`· 行内抑制 ${report.suppressedCount} 条`)

  const only = parsed.values.get('rule')
  const ignore = parsed.values.get('ignore-rule')
  let filtered = report
  if (only) filtered = filterReport(filtered, (ruleId) => ruleId === normalizeRuleId(only))
  if (ignore) filtered = filterReport(filtered, (ruleId) => ruleId !== normalizeRuleId(ignore))

  const display = parsed.booleans.has('quiet') ? filterReport(filtered, (_, severity) => severity === 2) : filtered
  const format = parsed.values.get('format') ?? 'text'

  const rawMax = parsed.values.get('max-warnings')
  let maxWarnings: number | undefined
  if (rawMax !== undefined) {
    maxWarnings = Number(rawMax)
    if (!Number.isInteger(maxWarnings) || maxWarnings < 0) {
      throw new ChecksError('--max-warnings 必须是非负整数', 'USAGE')
    }
  }
  const maxWarningsExceeded = maxWarnings !== undefined && filtered.warningCount > maxWarnings

  const formatter = await resolveFormatter(cwd, format)
  const output = formatter(display, { cwd, maxWarningsExceeded })

  const outputFile = parsed.values.get('output-file')
  if (outputFile) fs.writeFileSync(path.resolve(cwd, outputFile), `${output}\n`)
  else io.out(output)

  if (filtered.errorCount > 0) return 1
  if (maxWarningsExceeded) return 1
  return 0
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    return await execute(argv, io)
  } catch (error) {
    if (error instanceof ChecksError) {
      io.err(`✗ ${error.message}`)
      return 2
    }
    io.err(`✗ ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
}
