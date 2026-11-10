import { describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'
import type { ChecksConfig } from '../src/types.ts'

const base: ChecksConfig = {
  roots: ['tests/fixtures/cycles'],
  rules: [{ use: 'cycles' }],
}

const run = async (config: ChecksConfig) => (await createChecker({ cwd: process.cwd(), config })).lintFiles()

const filesOf = (results: { filePath: string }[]): string[] =>
  results.map((result) => result.filePath.split('/').pop() ?? result.filePath).sort()

describe('checks/cycles', () => {
  it('报告双节点环、自引用与 type-only 环', async () => {
    const report = await run(base)
    expect(filesOf(report.results)).toEqual(['a.ts', 'e.ts', 'self.ts', 'type-a.ts'])
    expect(report.results.some((result) => result.filePath.endsWith('c.ts'))).toBe(false)
    expect(report.results.some((result) => result.filePath.endsWith('.md'))).toBe(false)
  })

  it('ignoreTypeOnly 时跳过 type-only 环', async () => {
    const report = await run({
      ...base,
      rules: [{ use: 'cycles', options: { ignoreTypeOnly: true } }],
    })
    expect(filesOf(report.results)).toEqual(['a.ts', 'e.ts', 'self.ts'])
  })

  it('每个强连通分量只报一条，消息给出规范环', async () => {
    const report = await run(base)
    const cycle = report.results.find((result) => result.filePath.endsWith('a.ts'))
    expect(cycle?.messages).toHaveLength(1)
    expect(cycle?.messages[0]?.message).toMatch(/^循环依赖：.* → /)
    expect(cycle?.messages[0]?.ruleId).toBe('checks/cycles')
  })

  it('非法选项报配置错误', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: { roots: ['tests/fixtures/cycles'], rules: [{ use: 'cycles', options: { ignoreTypeOnly: 'yes' } }] },
    })
    await expect(checker.lintFiles()).rejects.toMatchObject({ code: 'CONFIG' })
  })
})
