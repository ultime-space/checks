import { describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'

const checkerWith = (options: Record<string, unknown>, severity?: 'error' | 'warn') =>
  createChecker({
    cwd: process.cwd(),
    config: { rules: [{ use: 'text', ...(severity ? { severity } : {}), options }] },
  })

describe('checks/text', () => {
  it('在注释里命中词表并报告行号', async () => {
    const checker = await checkerWith({ include: 'comments', deny: [{ pattern: 'docs/' }] })
    const report = await checker.lintText('const value = 1\n// 见 docs/spec.md\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(1)
    expect(report.results[0]?.filePath).toBe('a.ts')
    expect(report.results[0]?.messages[0]).toMatchObject({
      ruleId: 'checks/text',
      severity: 2,
      line: 2,
      message: '禁止出现：docs/',
    })
  })

  it('include=comments 不扫描字符串里的同名文本', async () => {
    const checker = await checkerWith({ include: 'comments', deny: ['docs/'] })
    const report = await checker.lintText("const path = 'docs/spec.md'\n// 注释\n", { filePath: 'a.ts' })

    expect(report.errorCount).toBe(0)
  })

  it('include=code 跳过注释、保留代码', async () => {
    const checker = await checkerWith({ include: 'code', deny: ['docs/'] })
    const report = await checker.lintText("// docs/spec.md\nconst path = 'docs/spec.md'\n", { filePath: 'a.ts' })

    expect(report.errorCount).toBe(1)
    expect(report.results[0]?.messages[0]?.line).toBe(2)
  })

  it('accept 按行放行', async () => {
    const checker = await checkerWith({ include: 'all', deny: ['内部'], accept: ['CHANGELOG'] })
    const report = await checker.lintText('// CHANGELOG 内部说明\n// 内部说明\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(1)
    expect(report.results[0]?.messages[0]?.line).toBe(2)
  })

  it('配置 severity=warn 时输出 warning', async () => {
    const checker = await checkerWith({ deny: ['内部'] }, 'warn')
    const report = await checker.lintText('// 内部说明\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(0)
    expect(report.warningCount).toBe(1)
    expect(report.results[0]?.messages[0]?.severity).toBe(1)
  })

  it('非法的 include 报配置错误', async () => {
    const checker = await checkerWith({ include: 'nope' })
    await expect(checker.lintText('const a = 1\n', { filePath: 'a.ts' })).rejects.toThrow(/include/)
  })

  it('只扫描 scope 命中的文件', async () => {
    const checker = await checkerWith({ scope: ['src/**'], deny: ['内部'] })
    const report = await checker.lintText('// 内部\n', { filePath: 'docs/a.ts' })

    expect(report.errorCount).toBe(0)
  })
})
