import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { runCli, type CliIo } from '../src/cli-run.ts'
import { createChecker } from '../src/index.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-baseline-'))
  temps.push(dir)
  return dir
}

const writeJson = (dir: string, file: string, data: unknown): void => {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data))
}

const writeBaseline = (dir: string, findings: Record<string, Record<string, number>>): void => {
  writeJson(dir, '.checks-baseline.json', { version: 1, tool: 'test', findings })
}

const collector = (cwd: string): { io: CliIo; out: string[]; err: string[] } => {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd, out: (line) => out.push(line), err: (line) => err.push(line) }, out, err }
}

const config = { rules: [{ use: 'text', options: { deny: ['内部'] } }] }

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('baseline', () => {
  it('按 file + rule 抵掉存量，并报告失效条目', async () => {
    const dir = tempDir()
    writeBaseline(dir, { 'a.ts': { 'checks/text': 3 } })

    const checker = await createChecker({ cwd: dir, config })
    const report = await checker.lintText('// 内部\n// 内部\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(0)
    expect(report.baseline).toEqual({ suppressed: 2, stale: 1 })
  })

  it('超出基线的部分继续报', async () => {
    const dir = tempDir()
    writeBaseline(dir, { 'a.ts': { 'checks/text': 1 } })

    const checker = await createChecker({ cwd: dir, config })
    const report = await checker.lintText('// 内部\n// 内部\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(1)
    expect(report.baseline).toEqual({ suppressed: 1, stale: 0 })
  })

  it('单次运行可关闭基线', async () => {
    const dir = tempDir()
    writeBaseline(dir, { 'a.ts': { 'checks/text': 2 } })

    const checker = await createChecker({ cwd: dir, config })
    const report = await checker.lintText('// 内部\n// 内部\n', { filePath: 'a.ts', baseline: false })

    expect(report.errorCount).toBe(2)
    expect(report.baseline).toBeUndefined()
  })

  it('基线文件损坏时报 CONFIG 错误', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, '.checks-baseline.json'), 'not json')

    const checker = await createChecker({ cwd: dir, config })
    await expect(checker.lintText('// 内部\n', { filePath: 'a.ts' })).rejects.toMatchObject({ code: 'CONFIG' })
  })

  it('--update-baseline 写入后可以直接通过，--prune-baseline 只收缩', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      `export default ${JSON.stringify({ roots: ['a.ts'], ...config })}`,
    )

    const previous = process.env.CI
    process.env.CI = ''
    try {
      expect(await runCli(['run', '--update-baseline'], collector(dir).io)).toBe(0)
      const written = JSON.parse(fs.readFileSync(path.join(dir, '.checks-baseline.json'), 'utf8')) as {
        findings: Record<string, Record<string, number>>
      }
      expect(written.findings['a.ts']?.['checks/text']).toBe(2)

      expect(await runCli(['run'], collector(dir).io)).toBe(0)

      fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1\n')
      expect(await runCli(['run', '--prune-baseline'], collector(dir).io)).toBe(0)
      const pruned = JSON.parse(fs.readFileSync(path.join(dir, '.checks-baseline.json'), 'utf8')) as {
        findings: Record<string, Record<string, number>>
      }
      expect(pruned.findings).toEqual({})
    } finally {
      if (previous === undefined) delete process.env.CI
      else process.env.CI = previous
    }
  })

  it('CI 环境拒绝 --update-baseline', async () => {
    const dir = tempDir()
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      `export default ${JSON.stringify({ roots: ['a.ts'], ...config })}`,
    )

    const previous = process.env.CI
    process.env.CI = '1'
    try {
      expect(await runCli(['run', '--update-baseline'], collector(dir).io)).toBe(2)
    } finally {
      if (previous === undefined) delete process.env.CI
      else process.env.CI = previous
    }
  })
})
