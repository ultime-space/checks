import { describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'
import type { ChecksConfig } from '../src/types.ts'

const roots = ['tests/fixtures/resolver']

const resolveAlias = async (specifier: string): Promise<string | null> => {
  if (specifier === '@app/a') return 'tests/fixtures/resolver/a.ts'
  if (specifier === '@app/b') return 'tests/fixtures/resolver/b.ts'
  if (specifier === './does-not-exist') return 'tests/fixtures/resolver/b.ts'
  return null
}

const cyclesConfig: ChecksConfig = { roots, rules: [{ use: 'cycles' }] }

describe('resolver', () => {
  it('宿主 resolver 让别名参与环检测', async () => {
    const without = await createChecker({ cwd: process.cwd(), config: cyclesConfig })
    expect((await without.lintFiles()).results).toEqual([])

    const withResolver = await createChecker({
      cwd: process.cwd(),
      config: cyclesConfig,
      resolver: resolveAlias,
    })
    const report = await withResolver.lintFiles()
    expect(report.results.map((result) => result.filePath.split('/').pop())).toEqual(['a.ts'])
  })

  it('resolver 可以接管相对引用的解析', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: { roots, rules: [{ use: 'unresolved' }] },
      resolver: resolveAlias,
    })
    const report = await checker.lintFiles()
    expect(report.results.some((result) => result.filePath.endsWith('broken.ts'))).toBe(false)
  })
})
