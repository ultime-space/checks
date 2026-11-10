export type Severity = 'error' | 'warn'

/** 规则内部使用的原始结果。 */
export interface Finding {
  ruleId: string
  level: Severity
  /** posix，相对 workspaceRoot。 */
  file: string
  line?: number
  column?: number
  message: string
  hint?: string
  /** 工具局限或选项语义决定级别，不允许被规则级 severity 改写。 */
  locked?: boolean
}

/**
 * 对外结果贴 ESLint 的 `LintResult` 形状：severity 用 1 / 2，
 * 便于现有 formatter / reporter 直接消费，但不依赖 ESLint。
 */
export interface CheckMessage {
  ruleId: string
  severity: 1 | 2
  message: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  hint?: string
  fatal?: boolean
}

export interface CheckResult {
  filePath: string
  messages: CheckMessage[]
  errorCount: number
  warningCount: number
}

export interface SkippedRule {
  ruleId: string
  reason: string
}

export interface CheckReport {
  results: CheckResult[]
  errorCount: number
  warningCount: number
  skipped: SkippedRule[]
  suppressedCount?: number
  baseline?: { suppressed: number; stale: number }
}

export interface TextPattern {
  pattern: string
  flags?: string
  message?: string
}

export interface TextRuleOptions {
  scope?: string[]
  include?: 'all' | 'code' | 'comments' | 'docs'
  deny?: Array<string | TextPattern>
  warn?: Array<string | TextPattern>
  accept?: string[]
}

export interface RuleConfig {
  use: string
  severity?: Severity
  options?: Record<string, unknown>
  timeout?: number
}

export interface ChecksOverride {
  /** 相对 workspaceRoot 的 glob。 */
  files: string[]
  rules: RuleConfig[]
}

export interface ChecksConfig {
  /** 填了按 workspace 模式解析；首版先只作为语义标记保留。 */
  workspace?: string
  roots?: string[]
  ignore?: string[]
  baseline?: string
  rules?: RuleConfig[]
  overrides?: ChecksOverride[]
}

export interface CheckerOptions {
  cwd?: string
  config?: string | ChecksConfig
  /** 基线文件；`false` 关闭，缺省用配置值或 `.checks-baseline.json`。 */
  baseline?: string | false
  /** 宿主解析器；首版先由后续规则使用。 */
  resolver?: (specifier: string, importer: string) => string | null | Promise<string | null>
}

export interface RunOptions {
  signal?: AbortSignal
  /** 单次运行是否应用基线，默认 true。 */
  baseline?: boolean
  /** 只检查这些文件（相对 workspaceRoot 的 posix 路径），用于 --changed / --since。 */
  onlyFiles?: string[]
}

export interface RuleContext {
  workspaceRoot: string
  root: string
  /** posix，相对 workspaceRoot。 */
  files: string[]
  read(file: string): string
  exists(file: string): boolean
  glob(patterns: string[]): string[]
  /** 解析引用：内置相对解析，或宿主注入的 resolver。返回相对 workspaceRoot 的 posix 路径。 */
  resolve(specifier: string, importer: string): Promise<string | null>
}

export interface Rule {
  name: string
  description: string
  run(ctx: RuleContext, options: Record<string, unknown>): Finding[] | Promise<Finding[]>
}

export interface Checker {
  lintFiles(patterns?: string[], options?: RunOptions): Promise<CheckReport>
  lintText(code: string, options: { filePath: string } & RunOptions): Promise<CheckReport>
  getConfig(): ChecksConfig
}
