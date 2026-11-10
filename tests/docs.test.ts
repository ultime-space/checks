import { describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'
import type { CheckReport, ChecksConfig } from '../src/types.ts'

const base: ChecksConfig = {
  roots: ['tests/fixtures/docs/docs'],
  rules: [
    {
      use: 'docs',
      options: {
        roots: ['tests/fixtures/docs/docs'],
        extraFiles: ['tests/fixtures/docs/docs/README.md'],
        status: { scope: ['tests/fixtures/docs/docs/roadmap/**'] },
        generated: ['**/*.generated.md'],
        anchors: 'warn',
      },
    },
  ],
}

const run = async (config: ChecksConfig = base): Promise<CheckReport> =>
  (await createChecker({ cwd: process.cwd(), config })).lintFiles()

const messagesOf = (report: CheckReport, suffix: string) =>
  report.results.find((result) => result.filePath.endsWith(suffix))?.messages ?? []

describe('checks/docs', () => {
  it('报告死链、大小写不匹配与孤儿文档', async () => {
    const report = await run()

    expect(messagesOf(report, 'docs/a.md').some((message) => message.message.includes('missing.md'))).toBe(true)
    expect(messagesOf(report, 'docs/b.md').some((message) => message.message.includes('Case.md'))).toBe(true)
    expect(messagesOf(report, 'docs/orphan.md')[0]?.message).toContain('没有被任何 README 链接')
  })

  it('锚点缺失按 warn 报告，中文锚点可以通过', async () => {
    const report = await run()
    const warnings = messagesOf(report, 'docs/b.md').filter((message) => message.severity === 1)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('#missing')
    expect(messagesOf(report, 'docs/b.md').some((message) => message.message.includes('#中文标题'))).toBe(false)
  })

  it('头部标记、开发计划状态、生成物豁免', async () => {
    const report = await run()

    expect(messagesOf(report, 'docs/nohead.md')[0]?.message).toContain('缺少「定位」')
    expect(messagesOf(report, 'roadmap/nostatus.md')[0]?.message).toContain('缺少「状态」')
    expect(messagesOf(report, 'generated.generated.md')).toEqual([])
  })

  it('总计 5 个 error 与 1 个 warning', async () => {
    const report = await run()
    expect(report.errorCount).toBe(5)
    expect(report.warningCount).toBe(1)
  })

  it('anchors=off 时不检查锚点', async () => {
    const report = await run({
      ...base,
      rules: [{ use: 'docs', options: { ...base.rules?.[0]?.options, anchors: 'off' } }],
    })
    expect(report.warningCount).toBe(0)
  })
})
