import fs from 'node:fs'
import path from 'node:path'
import {
  CliError,
  flagBool,
  flagValue,
  runCli as baseRunCli,
  type CliContext,
  type CliSpec,
  type FlagSpec,
  type ParsedArgs,
} from '@ultime/cli'
import { createChecker } from './api'
import { pruneBaseline, updateBaseline } from './baseline'
import { ChecksError } from './config'
import { resolveFormatter } from './formatters'
import { changedFiles } from './git'
import { builtinRules, ruleList } from './rules'
import { normalizeRuleId } from './rule-id'
import type { CheckReport } from './types'
import { packageVersion } from './version'

const HELP = `ultime-checks —— 仓库约束检测

用法：
  ultime-checks [run] [files...] [options]    运行检查（默认命令）
  ultime-checks rules [--json]                列出内置规则
  ultime-checks explain <rule>                查看规则文档
  ultime-checks --help | --version

选项：
  --config <path>            配置文件，默认 checks.config.mjs
  --cwd <dir>                启动目录，默认当前目录；检测根由配置 workspace 决定
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

const RUN_FLAGS: FlagSpec = {
  config: 'string',
  cwd: 'string',
  format: 'string',
  'output-file': 'string',
  'max-warnings': 'string',
  rule: 'string',
  'ignore-rule': 'string',
  'stdin-filename': 'string',
  baseline: 'string',
  since: 'string',
  stdin: 'boolean',
  quiet: 'boolean',
  'update-baseline': 'boolean',
  'prune-baseline': 'boolean',
  changed: 'boolean',
}

export interface CliIo {
  cwd?: string
  out(line: string): void
  err(line: string): void
  stdin?(): string
}

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

async function executeRun(args: ParsedArgs, ctx: CliContext, io: CliIo): Promise<number> {
  const cwd = path.resolve(ctx.cwd, flagValue(args, 'cwd') ?? '.')
  const baselinePath = flagValue(args, 'baseline')
  const update = flagBool(args, 'update-baseline')
  const prune = flagBool(args, 'prune-baseline')
  if (update && prune) throw new ChecksError('--update-baseline 与 --prune-baseline 不能同时使用', 'USAGE')
  if (update && process.env.CI) throw new ChecksError('CI 环境不允许生成基线', 'USAGE')

  const since = flagValue(args, 'since')
  const changed = flagBool(args, 'changed')
  if (since && changed) throw new ChecksError('--since 与 --changed 不能同时使用', 'USAGE')
  if ((since || changed) && (update || prune)) {
    throw new ChecksError('基线操作不能与 --since / --changed 同时使用', 'USAGE')
  }

  const checker = await createChecker({
    cwd,
    config: flagValue(args, 'config'),
    ...(baselinePath ? { baseline: baselinePath } : {}),
  })

  const onlyFiles = since || changed ? changedFiles(checker.workspaceRoot, since) : undefined

  const useStdin = flagBool(args, 'stdin')
  const stdinFile = flagValue(args, 'stdin-filename')
  if (useStdin && !stdinFile) throw new ChecksError('--stdin 需要同时指定 --stdin-filename', 'USAGE')

  const files = args.positional
  const runOptions = { baseline: !update && !prune, ...(onlyFiles ? { onlyFiles } : {}) }
  const report = useStdin
    ? await checker.lintText(io.stdin ? io.stdin() : fs.readFileSync(0, 'utf8'), {
        filePath: stdinFile ?? '',
        ...runOptions,
      })
    : await checker.lintFiles(files.length > 0 ? files : undefined, runOptions)

  const baselineFile = baselinePath ?? checker.getConfig().baseline ?? '.checks-baseline.json'
  if (update || prune) {
    if (update) updateBaseline(checker.workspaceRoot, baselineFile, report)
    else pruneBaseline(checker.workspaceRoot, baselineFile, report)
    ctx.err(`✓ 基线已${update ? '更新' : '收缩'}：${baselineFile}`)
    return 0
  }

  if (report.baseline?.stale) {
    ctx.err(`⚠ 基线条目已失效：${report.baseline.stale} 条，运行 --prune-baseline 收缩`)
  }
  if (report.suppressedCount) ctx.err(`· 行内抑制 ${report.suppressedCount} 条`)

  const only = flagValue(args, 'rule')
  const ignore = flagValue(args, 'ignore-rule')
  let filtered = report
  if (only) filtered = filterReport(filtered, (ruleId) => ruleId === normalizeRuleId(only))
  if (ignore) filtered = filterReport(filtered, (ruleId) => ruleId !== normalizeRuleId(ignore))

  const display = flagBool(args, 'quiet') ? filterReport(filtered, (_, severity) => severity === 2) : filtered
  const format = flagValue(args, 'format') ?? 'text'

  const rawMax = flagValue(args, 'max-warnings')
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

  const outputFile = flagValue(args, 'output-file')
  if (outputFile) fs.writeFileSync(path.resolve(cwd, outputFile), `${output}\n`)
  else ctx.out(output)

  if (filtered.errorCount > 0) return 1
  if (maxWarningsExceeded) return 1
  return 0
}

function createSpec(io: CliIo): CliSpec {
  return {
    name: 'ultime-checks',
    version: packageVersion(),
    usage: HELP,
    defaultCommand: 'run',
    commands: {
      run: {
        help: 'ultime-checks run [files...] [options]',
        flags: RUN_FLAGS,
        run: (args, ctx) => executeRun(args, ctx, io),
      },
      rules: {
        help: 'ultime-checks rules [--json]',
        flags: {},
        run: (args, ctx) => {
          if (flagBool(args, 'json')) {
            ctx.out(
              JSON.stringify(
                ruleList().map((rule) => ({ id: `checks/${rule.name}`, description: rule.description })),
                null,
                2,
              ),
            )
            return 0
          }
          for (const rule of ruleList()) ctx.out(`checks/${rule.name}  ${rule.description}`)
          return 0
        },
      },
      explain: {
        help: 'ultime-checks explain <rule>',
        flags: {},
        run: (args, ctx) => {
          const name = args.positional[0]
          if (!name) throw new ChecksError('用法：ultime-checks explain <rule>', 'USAGE')
          const id = normalizeRuleId(name)
          const builtinName = id.startsWith('checks/') ? id.slice('checks/'.length) : undefined
          const rule = builtinName ? builtinRules[builtinName] : undefined
          if (!rule) throw new ChecksError(`未知规则：${name}（explain 只支持内置规则）`, 'USAGE')
          const file = new URL(`../docs/rules/${rule.name}.md`, import.meta.url)
          if (!fs.existsSync(file)) throw new ChecksError(`缺少规则文档：docs/rules/${rule.name}.md`, 'USAGE')
          ctx.out(fs.readFileSync(file, 'utf8').trimEnd())
          return 0
        },
      },
      help: {
        help: 'ultime-checks --help',
        flags: {},
        run: (_args, ctx) => {
          ctx.out(HELP)
          return 0
        },
      },
      version: {
        help: 'ultime-checks --version',
        flags: {},
        run: (_args, ctx) => {
          ctx.out(packageVersion())
          return 0
        },
      },
    },
    mapError: (error) => {
      if (error instanceof CliError) return error
      if (error instanceof ChecksError) return new CliError(error.message, { code: error.code, path: error.path })
      return new CliError(error instanceof Error ? error.message : String(error), { code: 'CHECKS' })
    },
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const ctx: CliContext = {
    cwd: io.cwd ?? process.cwd(),
    out: (line) => io.out(line),
    err: (line) => io.err(line),
  }
  return baseRunCli(createSpec(io), argv, ctx)
}
