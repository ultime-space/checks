import fs from 'node:fs'
import path from 'node:path'
import { ChecksError } from '../config'
import type { Finding, Rule } from '../types'

interface DocSetOptions {
  packages: string[]
  files: string[]
  version: boolean
  versionMarker: string
  headWindow: number
  routing: { file: string; targets: string[] }
  exports: boolean
  naming: boolean
  rulesMin: number
  allowRootDocs: string[]
}

const DEFAULT_FILES = ['AGENTS.md', 'rules/README.md', 'llms.txt', 'SKILLS.md']
const DEFAULT_ROOT_DOCS = [
  'README.md',
  'DESIGN.md',
  'AGENTS.md',
  'SKILLS.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
]

const asStringArray = (value: unknown, field: string): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError(`doc-set.${field} 必须是字符串数组`, 'CONFIG')
  }
  return value as string[]
}

const asBoolean = (value: unknown, field: string, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ChecksError(`doc-set.${field} 必须是布尔值`, 'CONFIG')
  return value
}

function parseOptions(input: Record<string, unknown>): DocSetOptions {
  const routing = (input.routing ?? {}) as Record<string, unknown>
  return {
    packages: asStringArray(input.packages, 'packages') ?? [],
    files: asStringArray(input.files, 'files') ?? DEFAULT_FILES,
    version: asBoolean(input.version, 'version', true),
    versionMarker: typeof input.versionMarker === 'string' ? input.versionMarker : '适用版本',
    headWindow: typeof input.headWindow === 'number' ? input.headWindow : 12,
    routing: {
      file: typeof routing.file === 'string' ? routing.file : 'llms.txt',
      targets: asStringArray(routing.targets, 'routing.targets') ?? ['SKILLS.md'],
    },
    exports: asBoolean(input.exports, 'exports', true),
    naming: asBoolean(input.naming, 'naming', true),
    rulesMin: typeof input.rulesMin === 'number' ? input.rulesMin : 3,
    allowRootDocs: asStringArray(input.allowRootDocs, 'allowRootDocs') ?? DEFAULT_ROOT_DOCS,
  }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const codeExportKeys = (exportsField: Record<string, unknown>): string[] =>
  Object.keys(exportsField).filter((key) => {
    const value = exportsField[key]
    return typeof value === 'object' && value !== null && ('import' in value || 'require' in value)
  })

function exportIssues(packageName: string, exportsField: Record<string, unknown>, text: string): string[] {
  const keys = Object.keys(exportsField)
  const mentioned = new Set<string>()
  const pattern = new RegExp(`${escapeRegExp(packageName)}(/[A-Za-z0-9._-]+)?`, 'g')
  for (const match of text.matchAll(pattern)) mentioned.add(match[1] ? `.${match[1]}` : '.')

  const issues: string[] = []
  for (const key of mentioned) {
    if (!keys.includes(key)) issues.push(`SKILLS.md 提到未声明的出口：${key}`)
  }
  for (const key of codeExportKeys(exportsField)) {
    if (!mentioned.has(key)) issues.push(`SKILLS.md 未覆盖代码出口：${key}`)
  }
  return issues
}

export const docSetRule: Rule = {
  name: 'doc-set',
  description: '检查包内 AI 文档齐全、版本戳、路由、出口覆盖与包根命名',
  optionKeys: [
    'packages',
    'files',
    'version',
    'versionMarker',
    'headWindow',
    'routing',
    'exports',
    'naming',
    'rulesMin',
    'allowRootDocs',
  ],
  run(ctx, rawOptions) {
    const options = parseOptions(rawOptions)
    if (options.packages.length === 0) return []

    const findings: Finding[] = []
    const push = (file: string, message: string, hint: string): void => {
      findings.push({ ruleId: 'checks/doc-set', level: 'error', file, message, hint })
    }

    for (const root of options.packages) {
      const pkgFile = path.posix.join(root, 'package.json')
      let pkg: Record<string, unknown>
      try {
        pkg = JSON.parse(ctx.read(pkgFile)) as Record<string, unknown>
      } catch {
        push(pkgFile, '缺少或无法解析 package.json', '补包描述文件')
        continue
      }

      const version = typeof pkg.version === 'string' ? pkg.version : ''
      const family = version.split('.').slice(0, 2).join('.')
      const packageName = typeof pkg.name === 'string' ? pkg.name : ''

      for (const relative of options.files) {
        const file = path.posix.join(root, relative)
        if (!ctx.exists(file)) {
          push(file, '文件缺失', '按包级 AI 文档约定补齐')
          continue
        }

        if (!options.version || !family) continue
        const head = ctx.read(file).split('\n').slice(0, options.headWindow).join('\n')
        const match = new RegExp(`${escapeRegExp(options.versionMarker)}[：:]\\s*(\\d+\\.\\d+)`).exec(head)
        if (!match) push(file, `前 ${options.headWindow} 行缺少「${options.versionMarker}：X.Y.x」`, '补版本戳')
        else if (match[1] !== family) push(file, `版本戳 ${match[1]} 与 package.json ${family} 不一致`, '同步版本戳')
      }

      const routingFile = path.posix.join(root, options.routing.file)
      if (ctx.exists(routingFile)) {
        const text = ctx.read(routingFile)
        for (const target of options.routing.targets) {
          if (!text.includes(target)) push(routingFile, `未路由到 ${target}`, '在 llms.txt 增加路由')
        }
      }

      const skillsFile = path.posix.join(root, 'SKILLS.md')
      if (options.exports && packageName && ctx.exists(skillsFile)) {
        const exportsField = (pkg.exports ?? {}) as Record<string, unknown>
        for (const issue of exportIssues(packageName, exportsField, ctx.read(skillsFile))) {
          push(skillsFile, issue, '同步 SKILLS.md 与 exports')
        }
      }

      if (options.naming) {
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(path.resolve(ctx.workspaceRoot, root), { withFileTypes: true })
        } catch {
          entries = []
        }
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && /[A-Z]/.test(entry.name)) {
              push(path.posix.join(root, entry.name), `目录名应为小写：${entry.name}/`, '改为 kebab-case')
            }
            continue
          }
          if (entry.name.endsWith('.md') && !options.allowRootDocs.includes(entry.name)) {
            push(path.posix.join(root, entry.name), `包根文档名不在约定内：${entry.name}`, '改用全大写约定名')
          }
        }
      }

      const rulesDir = path.resolve(ctx.workspaceRoot, root, 'rules')
      if (ctx.exists(path.posix.join(root, 'rules')) && fs.existsSync(rulesDir)) {
        const count = fs.readdirSync(rulesDir).filter((file) => file.endsWith('.md')).length
        if (count < options.rulesMin) {
          push(path.posix.join(root, 'rules'), `至少 ${options.rulesMin} 篇规则，当前 ${count}`, '补本包开发规范')
        }
      }
    }

    return findings
  },
}
