import { describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'
import type { CheckReport, ChecksConfig } from '../src/types.ts'

const good = 'tests/fixtures/doc-set/packages/good'
const bad = 'tests/fixtures/doc-set/packages/bad'

const config: ChecksConfig = {
  roots: ['tests/fixtures/doc-set/packages'],
  rules: [{ use: 'doc-set', options: { packages: [good, bad] } }],
}

const run = async (): Promise<CheckReport> => (await createChecker({ cwd: process.cwd(), config })).lintFiles()

const messagesOf = (report: CheckReport, prefix: string) =>
  report.results.filter((result) => result.filePath.startsWith(prefix)).flatMap((result) => result.messages)

describe('checks/doc-set', () => {
  it('合规包没有 finding', async () => {
    const report = await run()
    expect(messagesOf(report, good)).toEqual([])
  })

  it('报告版本戳、路由、出口覆盖、命名与规则数量问题', async () => {
    const report = await run()
    const messages = messagesOf(report, bad).map((message) => message.message)

    expect(messages).toContain('版本戳 1.2 与 package.json 1.3 不一致')
    expect(messages).toContain('未路由到 SKILLS.md')
    expect(messages).toContain('SKILLS.md 提到未声明的出口：./missing')
    expect(messages).toContain('SKILLS.md 未覆盖代码出口：.')
    expect(messages).toContain('目录名应为小写：Docs/')
    expect(messages).toContain('包根文档名不在约定内：notes.md')
    expect(messages.some((message) => message.includes('至少 3 篇规则'))).toBe(true)
  })

  it('packages 为空时不运行', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: { roots: ['tests/fixtures/doc-set/packages'], rules: [{ use: 'doc-set' }] },
    })
    const report = await checker.lintFiles()
    expect(report.results).toEqual([])
  })
})
