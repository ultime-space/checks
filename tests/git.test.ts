import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { runCli, type CliIo } from '../src/cli-run.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-git-'))
  temps.push(dir)
  return dir
}

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

const collector = (cwd: string): { io: CliIo; out: string[]; err: string[] } => {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd, out: (line) => out.push(line), err: (line) => err.push(line) }, out, err }
}

const setupRepo = (): string => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'b.ts'), '// 内部\n')
  fs.writeFileSync(
    path.join(dir, 'checks.config.mjs'),
    "export default { roots: ['a.ts', 'b.ts'], rules: [{ use: 'text', options: { deny: ['内部'] } }] }\n",
  )
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init')
  fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('--changed / --since', () => {
  it('默认检查全部文件', async () => {
    const { io, out } = collector(setupRepo())
    expect(await runCli(['run'], io)).toBe(1)
    expect(out.join('\n')).toContain('a.ts')
    expect(out.join('\n')).toContain('b.ts')
  })

  it('--changed 只检查工作区改动', async () => {
    const { io, out } = collector(setupRepo())
    expect(await runCli(['run', '--changed'], io)).toBe(1)
    expect(out.join('\n')).toContain('a.ts')
    expect(out.join('\n')).not.toContain('b.ts')
  })

  it('--since HEAD 只检查 ref 之后的改动', async () => {
    const { io, out } = collector(setupRepo())
    expect(await runCli(['run', '--since', 'HEAD'], io)).toBe(1)
    expect(out.join('\n')).toContain('a.ts')
    expect(out.join('\n')).not.toContain('b.ts')
  })

  it('非 git 目录退出码 2', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'checks.config.mjs'), 'export default { roots: [], rules: [] }\n')
    const { io, err } = collector(dir)
    expect(await runCli(['run', '--changed'], io)).toBe(2)
    expect(err.join('\n')).toContain('git')
  })

  it('--since 与 --changed 不能同时使用', async () => {
    const { io } = collector(setupRepo())
    expect(await runCli(['run', '--since', 'HEAD', '--changed'], io)).toBe(2)
  })
})
