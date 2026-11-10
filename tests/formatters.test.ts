import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { runCli, type CliIo } from '../src/cli-run.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-format-'))
  temps.push(dir)
  return dir
}

const collector = (cwd: string): { io: CliIo; out: string[]; err: string[] } => {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd, out: (line) => out.push(line), err: (line) => err.push(line) }, out, err }
}

const setup = (): string => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
  fs.writeFileSync(
    path.join(dir, 'checks.config.mjs'),
    "export default { roots: ['a.ts'], rules: [{ use: 'text', options: { deny: ['内部'] } }] }\n",
  )
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('formatter', () => {
  it('--format sarif 输出 SARIF 2.1.0', async () => {
    const { io, out } = collector(setup())
    expect(await runCli(['run', '--format', 'sarif'], io)).toBe(1)

    const sarif = JSON.parse(out.join('\n')) as {
      version: string
      runs: { results: { ruleId: string; level: string; partialFingerprints: Record<string, string> }[] }[]
    }
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe('checks/text')
    expect(sarif.runs[0]?.results[0]?.level).toBe('error')
    expect(sarif.runs[0]?.results[0]?.partialFingerprints.primaryLocationLineHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('--format github 输出注解', async () => {
    const { io, out } = collector(setup())
    expect(await runCli(['run', '--format', 'github'], io)).toBe(1)
    expect(out.join('\n')).toContain('::error file=a.ts,line=1,col=')
  })

  it('--format 可以加载自定义模块', async () => {
    const dir = setup()
    fs.writeFileSync(
      path.join(dir, 'fmt.mjs'),
      'export default (results, meta) => `custom:${results.length}:${meta.toolVersion}`\n',
    )

    const { io, out } = collector(dir)
    expect(await runCli(['run', '--format', './fmt.mjs'], io)).toBe(1)
    expect(out.join('\n')).toMatch(/^custom:1:\d+\.\d+\.\d+$/)
  })

  it('formatter 加载失败时退出码 2', async () => {
    const { io, err } = collector(setup())
    expect(await runCli(['run', '--format', './missing.mjs'], io)).toBe(2)
    expect(err.join('\n')).toContain('无法加载 formatter')
  })
})
