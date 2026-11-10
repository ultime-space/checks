import fs from 'node:fs'

export function packageVersion(): string {
  try {
    const file = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
