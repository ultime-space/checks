import fs from 'node:fs'
import path from 'node:path'
import { compileGlob, globBase, hasMagic, matchGlob, normalizePattern } from './glob'

const ALWAYS_SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.tmp', '.vite-hooks'])

export const toPosix = (value: string): string => value.split(path.sep).join('/')

const isFile = (file: string): boolean => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

const isDir = (file: string): boolean => {
  try {
    return fs.statSync(file).isDirectory()
  } catch {
    return false
  }
}

function walk(dir: string, collected: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ALWAYS_SKIP.has(entry.name) || entry.name === '.DS_Store') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, collected)
    else if (entry.isFile()) collected.push(full)
  }
}

/** 忽略规则：不含 `/` 的模式匹配任一路径段，含 `/` 的模式匹配整条相对路径。 */
export function isIgnored(file: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const pattern = normalizePattern(raw)
    if (!pattern) continue
    if (!pattern.includes('/')) {
      if (file.split('/').some((segment) => matchGlob(pattern, segment))) return true
    } else if (matchGlob(pattern, file)) {
      return true
    }
  }
  return false
}

export interface ScanOptions {
  cwd: string
  patterns: string[]
  ignore?: string[]
}

/** 接受文件、目录与 glob；只返回 cwd 内的相对 posix 路径，结果去重并排序。 */
export function expandPatterns({ cwd, patterns, ignore = [] }: ScanOptions): string[] {
  const found = new Set<string>()
  const add = (absolute: string): void => {
    const relative = toPosix(path.relative(cwd, absolute))
    if (!relative || relative.startsWith('..')) return
    if (isIgnored(relative, ignore)) return
    found.add(relative)
  }

  for (const raw of patterns) {
    const pattern = normalizePattern(raw)
    if (!pattern) continue

    if (!hasMagic(pattern)) {
      const absolute = path.resolve(cwd, pattern)
      if (isFile(absolute)) add(absolute)
      else if (isDir(absolute)) {
        const files: string[] = []
        walk(absolute, files)
        for (const file of files) add(file)
      }
      continue
    }

    const base = path.resolve(cwd, globBase(pattern))
    if (!isDir(base)) continue
    const files: string[] = []
    walk(base, files)
    const regex = compileGlob(pattern)
    for (const file of files) {
      const relative = toPosix(path.relative(cwd, file))
      if (regex.test(relative)) add(file)
    }
  }

  return [...found].sort()
}
