import { extname } from 'node:path'

type Range = [start: number, end: number]

const JS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const CSS_EXT = new Set(['.css', '.scss', '.sass', '.less'])
const HTML_EXT = new Set(['.html', '.htm', '.vue'])

function scanCssLike(text: string, lineComments: boolean): Range[] {
  const ranges: Range[] = []
  let quote = ''
  let index = 0

  while (index < text.length) {
    const char = text[index]

    if (quote) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) quote = ''
      index++
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      index++
      continue
    }

    if (lineComments && char === '/' && text[index + 1] === '/') {
      const start = index
      index += 2
      while (index < text.length && text[index] !== '\n') index++
      ranges.push([start, index])
      continue
    }

    if (char === '/' && text[index + 1] === '*') {
      const start = index
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      index = Math.min(index + 2, text.length)
      ranges.push([start, index])
      continue
    }

    index++
  }

  return ranges
}

function scanHtml(text: string): Range[] {
  const ranges: Range[] = []
  let index = 0

  while (index < text.length) {
    const start = text.indexOf('<!--', index)
    if (start === -1) break
    const end = text.indexOf('-->', start + 4)
    const stop = end === -1 ? text.length : end + 3
    ranges.push([start, stop])
    index = stop
  }

  return ranges
}

export function commentRanges(text: string, file: string): Range[] {
  const ext = extname(file).toLowerCase()
  if (JS_EXT.has(ext)) return scanCssLike(text, true)
  if (CSS_EXT.has(ext)) return scanCssLike(text, false)
  if (HTML_EXT.has(ext)) return scanHtml(text)
  return []
}

/**
 * 按扫描面遮罩文本：长度与换行保持不变，正则命中的下标可以直接映射回原文件。
 * - `code`：遮住注释；
 * - `comments`：只留注释；
 * - `all` / `docs`：原样返回。
 */
export function maskText(text: string, file: string, include: 'all' | 'code' | 'comments' | 'docs'): string {
  if (include === 'all' || include === 'docs') return text

  const ranges = commentRanges(text, file)
  const chars = text.split('')
  const inside = new Uint8Array(text.length)
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index++) inside[index] = 1
  }

  for (let index = 0; index < chars.length; index++) {
    const keep = include === 'comments' ? inside[index] === 1 : inside[index] === 0
    if (!keep && chars[index] !== '\n') chars[index] = ' '
  }

  return chars.join('')
}
