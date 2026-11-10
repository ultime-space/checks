const MAGIC = /[*?{]/
const cache = new Map<string, RegExp>()

export const normalizePattern = (pattern: string): string => pattern.replace(/^\.\//, '').replace(/\\/g, '/')

export const hasMagic = (pattern: string): boolean => MAGIC.test(pattern)

const escapeLiteral = (value: string): string => value.replace(/[.+^$()|[\]\\]/g, '\\$&')

/** 取 glob 中第一个通配符之前的目录，作为遍历起点。 */
export function globBase(pattern: string): string {
  const parts = normalizePattern(pattern).split('/')
  const base: string[] = []
  for (const part of parts) {
    if (MAGIC.test(part)) break
    base.push(part)
  }
  return base.join('/') || '.'
}

/** 只支持 `*`、`**`、`?`、`{a,b}` 四个通配；其余按字面量处理。 */
export function compileGlob(pattern: string): RegExp {
  const key = normalizePattern(pattern)
  const cached = cache.get(key)
  if (cached) return cached

  let source = ''
  for (let index = 0; index < key.length; index++) {
    const char = key[index]
    if (char === '*') {
      if (key[index + 1] === '*') {
        index++
        if (key[index + 1] === '/') {
          index++
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    if (char === '{') {
      const end = key.indexOf('}', index)
      if (end > index) {
        const options = key
          .slice(index + 1, end)
          .split(',')
          .map(escapeLiteral)
        source += `(?:${options.join('|')})`
        index = end
        continue
      }
    }
    source += escapeLiteral(char ?? '')
  }

  const regex = new RegExp(`^${source}$`)
  cache.set(key, regex)
  return regex
}

export const matchGlob = (pattern: string, value: string): boolean => compileGlob(pattern).test(value)
