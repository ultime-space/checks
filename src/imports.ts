import fs from 'node:fs'
import path from 'node:path'
import { maskText } from './mask'
import { positionAt } from './position'
import { toPosix } from './scan'

export interface ImportRef {
  specifier: string
  line: number
  column: number
  typeOnly?: boolean
}

const JS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const CSS_EXT = new Set(['.css', '.scss', '.sass', '.less'])
const HTML_EXT = new Set(['.html', '.htm', '.vue'])
const DOC_EXT = new Set(['.md', '.mdx'])

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i

const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.htm',
  '.vue',
  '.md',
  '.mdx',
]

export const isRelativeSpecifier = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../')

export const isExternalSpecifier = (specifier: string): boolean => EXTERNAL.test(specifier)

/** `@scope/name/sub` → `@scope/name`，`name/sub` → `name`。 */
export function packageNameOf(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0] ?? specifier
}

function collect(
  source: string,
  patterns: RegExp[],
  allowBare: boolean,
  typeOnlyOf?: (match: RegExpExecArray) => boolean,
): ImportRef[] {
  const seen = new Set<string>()
  const refs: ImportRef[] = []

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1]
      if (!specifier || isExternalSpecifier(specifier) || specifier.includes('${')) continue
      if (!allowBare && !isRelativeSpecifier(specifier)) continue
      const index = match.index + match[0].indexOf(specifier)
      const position = positionAt(source, index)
      const key = `${specifier}\0${position.line}\0${position.column}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({
        specifier,
        line: position.line,
        column: position.column,
        ...(typeOnlyOf?.(match) ? { typeOnly: true } : {}),
      })
    }
  }

  return refs
}

/** 抽取 import / export / require / CSS / HTML / Markdown 里的引用，注释已遮罩。 */
export function extractImports(text: string, file: string): ImportRef[] {
  const ext = path.extname(file).toLowerCase()

  if (DOC_EXT.has(ext)) {
    return collect(text, [/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g], true)
  }

  const source = maskText(text, file, 'code')

  if (JS_EXT.has(ext)) {
    return [
      ...collect(source, [/^\s*import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm], true, (match) =>
        /^\s*import\s+type\b/.test(match[0]),
      ),
      ...collect(source, [/^\s*export\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/gm], true, (match) =>
        /^\s*export\s+type\b/.test(match[0]),
      ),
      ...collect(source, [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g], true),
    ]
  }

  if (CSS_EXT.has(ext)) {
    return collect(
      source,
      [/@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?/g, /\burl\(\s*['"]?([^'")]+)['"]?\s*\)/g],
      true,
    )
  }

  if (HTML_EXT.has(ext)) {
    return collect(source, [/\b(?:src|href)\s*=\s*["']([^"']+)["']/g], true)
  }

  return []
}

function candidates(base: string): string[] {
  const list = [base]
  const ext = path.extname(base)
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    const stem = base.slice(0, -ext.length)
    list.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`)
  }
  for (const extension of EXTENSIONS) {
    list.push(`${base}${extension}`)
    if (!ext) list.push(path.join(base, `index${extension}`))
  }
  return list
}

/** 解析相对引用；成功返回相对 workspaceRoot 的 posix 路径，失败返回 null。 */
export function resolveImport(cwd: string, fromFile: string, specifier: string): string | null {
  if (!isRelativeSpecifier(specifier)) return null
  const clean = specifier.split(/[?#]/)[0]
  if (!clean) return null

  const allowDirectory = /\.(md|mdx|html?|vue)$/i.test(fromFile)
  const base = path.resolve(cwd, path.dirname(fromFile), clean)

  for (const candidate of candidates(base)) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return toPosix(path.relative(cwd, candidate))
      if (allowDirectory && stat.isDirectory()) return toPosix(path.relative(cwd, candidate))
    } catch {
      continue
    }
  }
  return null
}
