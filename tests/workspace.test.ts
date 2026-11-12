import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'
import { runCli, type CliIo } from '../src/cli-run.ts'

const temps: string[] = []

function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-ws-'))
  temps.push(dir)
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return dir
}

const define = (config: Record<string, unknown>): string => `export default ${JSON.stringify(config)}\n`

const textRule = { use: 'text', options: { include: 'comments', deny: ['内部'] } }

const collector = (cwd: string): { io: CliIo; out: string[]; err: string[] } => {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd, out: (line) => out.push(line), err: (line) => err.push(line) }, out, err }
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('workspace 模式', () => {
  it('扫描与结果路径都相对 workspace 根', async () => {
    const dir = fixture({
      'checks.config.mjs': define({ workspace: 'packages/a', rules: [textRule] }),
      'packages/a/src/x.ts': '// 内部\n',
      'packages/a/dist/y.ts': '// 内部\n',
      'packages/b/src/z.ts': '// 内部\n',
    })

    const checker = await createChecker({ cwd: dir })
    expect(checker.workspaceRoot).toBe(path.join(dir, 'packages/a'))

    const report = await checker.lintFiles()
    expect(report.errorCount).toBe(1)
    expect(report.results.map((result) => result.filePath)).toEqual(['src/x.ts'])
  })

  it('overrides 相对 workspace 根匹配', async () => {
    const dir = fixture({
      'checks.config.mjs': define({
        workspace: 'packages/a',
        rules: [textRule],
        overrides: [{ files: ['tests/**'], rules: [{ use: 'text', severity: 'warn' }] }],
      }),
      'packages/a/tests/y.ts': '// 内部\n',
    })

    const checker = await createChecker({ cwd: dir })
    const report = await checker.lintFiles()
    expect(report.errorCount).toBe(0)
    expect(report.warningCount).toBe(1)
    expect(report.results[0]?.filePath).toBe('tests/y.ts')
  })

  it('baseline 相对 workspace 根读取', async () => {
    const dir = fixture({
      'checks.config.mjs': define({ workspace: 'packages/a', rules: [textRule] }),
      'packages/a/src/x.ts': '// 内部\n',
      'packages/a/.checks-baseline.json': JSON.stringify({
        version: 1,
        tool: '0.2.1',
        findings: { 'src/x.ts': { 'checks/text': 1 } },
      }),
    })

    const checker = await createChecker({ cwd: dir })
    const report = await checker.lintFiles()
    expect(report.errorCount).toBe(0)
    expect(report.suppressedCount).toBe(0)
    expect(report.baseline).toEqual({ suppressed: 1, stale: 0 })
  })

  it('CLI 与 Node API 输出一致', async () => {
    const dir = fixture({
      'checks.config.mjs': define({ workspace: 'packages/a', rules: [textRule] }),
      'packages/a/src/x.ts': '// 内部\n',
    })

    const checker = await createChecker({ cwd: dir })
    const api = await checker.lintFiles()

    const { io, out } = collector(dir)
    expect(await runCli(['run', '--format', 'json'], io)).toBe(1)
    const cli = JSON.parse(out.join('\n')) as { results: unknown }
    expect(cli.results).toEqual(api.results)
  })

  it('workspace 目录不存在时给字段错误', async () => {
    const dir = fixture({ 'checks.config.mjs': define({ workspace: 'packages/none', rules: [textRule] }) })
    await expect(createChecker({ cwd: dir })).rejects.toMatchObject({ code: 'CONFIG_FIELD', path: 'workspace' })
  })

  it('workspace 指向文件时给字段错误', async () => {
    const dir = fixture({
      'checks.config.mjs': define({ workspace: 'a.ts', rules: [textRule] }),
      'a.ts': '// 内部\n',
    })
    await expect(createChecker({ cwd: dir })).rejects.toMatchObject({ code: 'CONFIG_FIELD', path: 'workspace' })
  })

  it('lintText 的 filePath 相对 workspace 根校验', async () => {
    const dir = fixture({ 'checks.config.mjs': define({ workspace: 'packages/a', rules: [textRule] }) })
    fs.mkdirSync(path.join(dir, 'packages/a'), { recursive: true })

    const checker = await createChecker({ cwd: dir })
    const report = await checker.lintText('// 内部\n', { filePath: 'src/x.ts' })
    expect(report.results[0]?.filePath).toBe('src/x.ts')
    await expect(checker.lintText('const a = 1\n', { filePath: '../x.ts' })).rejects.toMatchObject({ code: 'USAGE' })
  })
})
