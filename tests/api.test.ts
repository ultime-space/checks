import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createChecker, ChecksError } from '../src/index.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-api-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('createChecker', () => {
  it('lintFiles 返回 ESLint 形状的结果', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: {
        roots: ['tests/fixtures/basic'],
        rules: [{ use: 'text', options: { include: 'comments', deny: ['docs/'] } }],
      },
    })

    const report = await checker.lintFiles()
    expect(report.errorCount).toBe(1)
    expect(report.results[0]?.filePath).toBe('tests/fixtures/basic/src/bad.ts')
    expect(report.results[0]?.messages[0]).toMatchObject({
      ruleId: 'checks/text',
      severity: 2,
      line: 1,
    })
  })

  it('lintFiles 接受显式文件路径', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: { rules: [{ use: 'text', options: { include: 'comments', deny: ['docs/'] } }] },
    })

    const report = await checker.lintFiles(['tests/fixtures/basic/src/clean.ts'])
    expect(report.errorCount).toBe(0)
    expect(report.results).toEqual([])
  })

  it('overrides 按文件改规则', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: {
        rules: [{ use: 'text', options: { deny: ['内部'] } }],
        overrides: [{ files: ['docs/**'], rules: [{ use: 'text', severity: 'warn', options: { deny: ['内部'] } }] }],
      },
    })

    const report = await checker.lintText('// 内部\n', { filePath: 'docs/a.ts' })
    expect(report.warningCount).toBe(1)
    expect(report.errorCount).toBe(0)
  })

  it('未知规则抛 ChecksError', async () => {
    await expect(
      createChecker({
        cwd: process.cwd(),
        config: { rules: [{ use: 'nope' }] },
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_RULE' })
  })

  it('配置文件缺失时抛 CONFIG 错误', async () => {
    await expect(createChecker({ cwd: tempDir() })).rejects.toBeInstanceOf(ChecksError)
  })

  it('lintText 拒绝 cwd 之外的路径', async () => {
    const checker = await createChecker({ cwd: tempDir(), config: { rules: [] } })
    await expect(checker.lintText('const a = 1\n', { filePath: '../a.ts' })).rejects.toMatchObject({ code: 'USAGE' })
  })
})
