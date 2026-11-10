import { describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'

const checker = () =>
  createChecker({
    cwd: process.cwd(),
    baseline: false,
    config: { rules: [{ use: 'text', options: { deny: ['内部'] } }] },
  })

const lint = async (code: string) => (await checker()).lintText(code, { filePath: 'a.ts' })

describe('行内抑制', () => {
  it('带 reason 的指令抑制下一行', async () => {
    const report = await lint('// checks-ignore-next-line text reason="历史"\n// 内部\n')
    expect(report.errorCount).toBe(0)
    expect(report.suppressedCount).toBe(1)
  })

  it('缺少 reason 报诊断且不抑制', async () => {
    const report = await lint('// checks-ignore-next-line text\n// 内部\n')
    expect(report.errorCount).toBe(2)
    expect(report.results[0]?.messages.map((message) => message.ruleId).sort()).toEqual([
      'checks/suppress',
      'checks/text',
    ])
  })

  it('过期的指令报诊断且不抑制', async () => {
    const report = await lint('// checks-ignore-next-line text reason="历史" expires="2020-01-01"\n// 内部\n')
    expect(report.errorCount).toBe(2)
    expect(report.results[0]?.messages.some((message) => message.message.includes('已过期'))).toBe(true)
  })

  it('未过期的指令正常抑制', async () => {
    const report = await lint('// checks-ignore-next-line text reason="历史" expires="2999-01-01"\n// 内部\n')
    expect(report.errorCount).toBe(0)
  })

  it('规则名不匹配时不抑制', async () => {
    const report = await lint('// checks-ignore-next-line imports reason="历史"\n// 内部\n')
    expect(report.errorCount).toBe(1)
  })

  it('只作用于下一行', async () => {
    const report = await lint('// checks-ignore-next-line text reason="历史"\n\n// 内部\n')
    expect(report.errorCount).toBe(1)
  })

  it('不再识别 legacy boundary-allow', async () => {
    const report = await lint('// boundary-allow: 历史\n// 内部\n')
    expect(report.errorCount).toBe(1)
  })
})
