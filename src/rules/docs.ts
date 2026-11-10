import fs from 'node:fs'
import path from 'node:path'
import { ChecksError } from '../config'
import { matchGlob } from '../glob'
import { toPosix } from '../scan'
import type { Finding, Rule } from '../types'

interface DocsOptions {
  roots: string[]
  extraFiles: string[]
  headWindow: number
  headMarker: string
  statusScope: string[]
  statusMarker: string
  anchors: 'off' | 'warn' | 'error'
  generated: string[]
  orphanAllow: string[]
}

interface LinkRef {
  raw: string
  target: string
  anchor?: string
}

interface Headings {
  slugs: Set<string>
  nonAscii: boolean
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/gm
const INDEX_NAMES = new Set(['README.md'])
const EXTERNAL = /^(?:https?:|mailto:|tel:)/i

const asStringArray = (value: unknown, field: string): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChecksError(`docs.${field} 必须是字符串数组`, 'CONFIG')
  }
  return value as string[]
}

const asNumber = (value: unknown, field: string, fallback: number): number => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ChecksError(`docs.${field} 必须是正整数`, 'CONFIG')
  }
  return value
}

const asString = (value: unknown, field: string, fallback: string): string => {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length === 0) {
    throw new ChecksError(`docs.${field} 必须是非空字符串`, 'CONFIG')
  }
  return value
}

function parseOptions(input: Record<string, unknown>): DocsOptions {
  const head = (input.head ?? {}) as Record<string, unknown>
  const status = (input.status ?? {}) as Record<string, unknown>
  const anchors = (input.anchors ?? 'warn') as DocsOptions['anchors']
  if (!['off', 'warn', 'error'].includes(anchors)) {
    throw new ChecksError('docs.anchors 只能是 off / warn / error', 'CONFIG')
  }

  return {
    roots: asStringArray(input.roots, 'roots') ?? ['docs'],
    extraFiles: asStringArray(input.extraFiles, 'extraFiles') ?? ['README.md', 'AGENTS.md'],
    headWindow: asNumber(head.window, 'head.window', 12),
    headMarker: asString(head.marker, 'head.marker', '定位'),
    statusScope: asStringArray(status.scope, 'status.scope') ?? ['docs/roadmap/**'],
    statusMarker: asString(status.marker, 'status.marker', '状态'),
    anchors,
    generated: asStringArray(input.generated, 'generated') ?? [],
    orphanAllow: asStringArray(input.orphanAllow, 'orphanAllow') ?? [],
  }
}

/** 精确大小写存在性：逐段比对目录项，避免 macOS 本地通过、Linux CI 失败。 */
function resolveExact(cwd: string, target: string): string | null {
  const normalized = path.posix.normalize(target)
  if (!normalized || normalized === '.') return ''
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null

  let current = cwd
  for (const segment of normalized.split('/').filter(Boolean)) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return null
    }
    if (!entries.some((entry) => entry.name === segment)) return null
    current = path.join(current, segment)
  }

  return normalized
}

function parseLinks(text: string): LinkRef[] {
  const links: LinkRef[] = []
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(LINK_RE)) {
      const raw = match[1]
      if (!raw || EXTERNAL.test(raw)) continue
      const hash = raw.indexOf('#')
      const target = hash === -1 ? raw : raw.slice(0, hash)
      links.push({
        raw,
        target: decodeURIComponent(target),
        ...(hash === -1 ? {} : { anchor: decodeURIComponent(raw.slice(hash + 1)) }),
      })
    }
  }
  return links
}

function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

function readHeadings(cwd: string, file: string, cache: Map<string, Headings>): Headings {
  const cached = cache.get(file)
  if (cached) return cached

  const slugs = new Set<string>()
  const counts = new Map<string, number>()
  let nonAscii = false
  let text = ''
  try {
    text = fs.readFileSync(path.resolve(cwd, file), 'utf8')
  } catch {
    /* 文件不存在时由链接检查报告 */
  }

  for (const match of text.matchAll(HEADING_RE)) {
    const heading = match[1] ?? ''
    if (Buffer.byteLength(heading, 'utf8') !== heading.length) nonAscii = true
    const base = slugify(heading)
    if (!base) continue
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    slugs.add(count === 0 ? base : `${base}-${count}`)
  }

  const headings = { slugs, nonAscii }
  cache.set(file, headings)
  return headings
}

const anchorLevel = (options: DocsOptions, headings: Headings): 'error' | 'warn' | null => {
  if (options.anchors === 'off') return null
  if (options.anchors === 'error' && !headings.nonAscii) return 'error'
  return 'warn'
}

function checkAnchor(
  options: DocsOptions,
  cwd: string,
  file: string,
  anchor: string,
  cache: Map<string, Headings>,
): Finding | null {
  const headings = readHeadings(cwd, file, cache)
  if (headings.slugs.has(anchor)) return null
  const level = anchorLevel(options, headings)
  if (!level) return null
  return {
    ruleId: 'checks/docs',
    level,
    locked: true,
    file,
    message: `锚点不存在：#${anchor}`,
    hint: headings.nonAscii ? '标题含非 ASCII 字符，锚点仅供参考' : '检查标题或改用文件链接',
  }
}

export const docsRule: Rule = {
  name: 'docs',
  description: '检查相对链接、锚点、头部标记、开发计划状态与孤儿文档',
  run(ctx, rawOptions) {
    const options = parseOptions(rawOptions)
    const headings = new Map<string, Headings>()
    const findings: Finding[] = []

    const docsFiles = [...new Set(options.roots.flatMap((root) => ctx.glob([`${root}/**/*.md`])))].sort()
    const extraFiles = options.extraFiles.filter((file) => ctx.exists(file))
    const linkFiles = [...new Set([...docsFiles, ...extraFiles])].sort()

    for (const file of linkFiles) {
      const text = ctx.read(file)
      for (const link of parseLinks(text)) {
        const targetFile = link.target
          ? resolveExact(ctx.workspaceRoot, toPosix(path.posix.join(path.posix.dirname(file), link.target)))
          : file

        if (targetFile === null) {
          findings.push({
            ruleId: 'checks/docs',
            level: 'error',
            file,
            message: `链接不存在：${link.raw}`,
            hint: '检查路径与大小写',
          })
          continue
        }

        if (link.anchor === undefined || link.anchor === '') continue
        const absolute = targetFile ? path.resolve(ctx.workspaceRoot, targetFile) : undefined
        if (!absolute || !fs.statSync(absolute).isFile() || !targetFile.endsWith('.md')) continue

        const anchorFinding = checkAnchor(options, ctx.workspaceRoot, targetFile, link.anchor, headings)
        if (anchorFinding) findings.push({ ...anchorFinding, file })
      }
    }

    const linked = new Set<string>()
    for (const file of linkFiles) {
      for (const link of parseLinks(ctx.read(file))) {
        if (!link.target) continue
        const target = resolveExact(ctx.workspaceRoot, toPosix(path.posix.join(path.posix.dirname(file), link.target)))
        if (target && target !== file && target.endsWith('.md')) linked.add(target)
      }
    }

    for (const file of docsFiles) {
      const generated = options.generated.some((pattern) => matchGlob(pattern, file))
      const isIndex = INDEX_NAMES.has(path.posix.basename(file))
      const head = ctx.read(file).split('\n').slice(0, options.headWindow).join('\n')

      if (!generated && !head.includes(options.headMarker)) {
        findings.push({
          ruleId: 'checks/docs',
          level: 'error',
          file,
          message: `前 ${options.headWindow} 行缺少「${options.headMarker}」`,
          hint: '补三行头：定位 / 状态 / 关系',
        })
      }

      if (
        !generated &&
        !isIndex &&
        options.statusScope.some((pattern) => matchGlob(pattern, file)) &&
        !head.includes(options.statusMarker)
      ) {
        findings.push({
          ruleId: 'checks/docs',
          level: 'error',
          file,
          message: `开发计划缺少「${options.statusMarker}」`,
          hint: '在头部标明状态，或指向唯一状态源',
        })
      }

      if (isIndex) continue
      if (options.orphanAllow.some((pattern) => matchGlob(pattern, file))) continue
      if (!linked.has(file)) {
        findings.push({
          ruleId: 'checks/docs',
          level: 'error',
          file,
          message: '没有被任何 README 链接',
          hint: '从上级 README 增加入口',
        })
      }
    }

    return findings
  },
}
