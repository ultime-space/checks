import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { runCli, type CliIo } from '../src/cli-run.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-cli-'))
  temps.push(dir)
  return dir
}

const collector = (cwd?: string, stdin?: string): { io: CliIo; out: string[]; err: string[] } => {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      ...(cwd ? { cwd } : {}),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...(stdin === undefined ? {} : { stdin: () => stdin }),
    },
    out,
    err,
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('checks CLI', () => {
  it('--version 输出 semver', async () => {
    const { io, out } = collector()
    expect(await runCli(['--version'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('rules 列出内置规则', async () => {
    const { io, out } = collector()
    expect(await runCli(['rules'], io)).toBe(0)
    expect(out.join('\n')).toContain('checks/text')
  })

  it('有 error 时退出码 1', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['.'], rules: [{ use: 'text', options: { include: 'comments', deny: ['内部'] } }] }\n",
    )

    const { io, out } = collector(dir)
    expect(await runCli(['run'], io)).toBe(1)
    expect(out.join('\n')).toContain('a.ts')
  })

  it('--format json 输出机器可读结果', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['.'], rules: [{ use: 'text', options: { include: 'comments', deny: ['内部'] } }] }\n",
    )

    const { io, out } = collector(dir)
    expect(await runCli(['run', '--format', 'json'], io)).toBe(1)
    const parsed = JSON.parse(out.join('\n')) as { summary: { errorCount: number } }
    expect(parsed.summary.errorCount).toBe(1)
  })

  it('--stdin 配 --stdin-filename 走内存输入', async () => {
    const dir = tempDir()
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { rules: [{ use: 'text', options: { deny: ['内部'] } }] }\n",
    )

    const { io, out } = collector(dir, '// 内部\n')
    expect(await runCli(['run', '--stdin', '--stdin-filename', 'a.ts'], io)).toBe(1)
    expect(out.join('\n')).toContain('a.ts')
  })

  it('--max-warnings 超预算时退出码 1', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['.'], rules: [{ use: 'text', severity: 'warn', options: { include: 'comments', deny: ['内部'] } }] }\n",
    )

    const { io } = collector(dir)
    expect(await runCli(['run'], io)).toBe(0)
    const strict = collector(dir)
    expect(await runCli(['run', '--max-warnings', '0'], strict.io)).toBe(1)
  })

  it('配置缺失时退出码 2', async () => {
    const { io, err } = collector(tempDir())
    expect(await runCli(['run'], io)).toBe(2)
    expect(err.join('\n')).toContain('配置文件')
  })

  it('未知参数退出码 2', async () => {
    const { io } = collector()
    expect(await runCli(['run', '--nope'], io)).toBe(2)
  })

  it('--output-file 写文件而不是 stdout', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['.'], rules: [{ use: 'text', options: { include: 'comments', deny: ['内部'] } }] }\n",
    )

    const { io, out } = collector(dir)
    expect(await runCli(['run', '--output-file', 'result.txt'], io)).toBe(1)
    expect(out).toEqual([])
    expect(fs.readFileSync(path.join(dir, 'result.txt'), 'utf8')).toContain('a.ts')
  })
})
