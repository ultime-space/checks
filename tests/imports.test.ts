import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createChecker } from '../src/index.ts'
import type { CheckReport, ChecksConfig } from '../src/types.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-imports-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true })
})

const config: ChecksConfig = {
  roots: ['tests/fixtures/imports'],
  rules: [
    {
      use: 'imports',
      options: {
        packageRoots: [
          'tests/fixtures/imports/packages/a',
          'tests/fixtures/imports/packages/c',
          'tests/fixtures/imports/apps/demo',
        ],
        packages: ['@ultime/'],
        forbid: [{ pattern: '(^|/)packages/', scope: ['tests/fixtures/imports/apps/**'] }],
      },
    },
    { use: 'unresolved', severity: 'warn' },
  ],
}

const checker = () => createChecker({ cwd: process.cwd(), config })

const lintFixture = async (): Promise<CheckReport> => (await checker()).lintFiles()

const messagesOf = (report: CheckReport, suffix: string) =>
  report.results.find((result) => result.filePath.endsWith(suffix))?.messages ?? []

describe('checks/imports', () => {
  it('报告未声明依赖、引用上游源码与相对路径越界', async () => {
    const report = await lintFixture()
    const messages = messagesOf(report, 'packages/a/src/index.ts')

    const undeclared = messages.find((message) => message.message.includes('未声明依赖'))
    expect(undeclared).toMatchObject({ ruleId: 'checks/imports', severity: 2, line: 2 })
    expect(undeclared?.message).toContain('@ultime/c')

    expect(messages.find((message) => message.message.includes('引用上游源码'))?.line).toBe(3)
    expect(messages.find((message) => message.message.includes('相对路径跨出'))?.line).toBe(7)
    expect(messages.some((message) => message.message.includes('@ultime/b'))).toBe(false)
  })

  it('覆盖 CSS / HTML / Markdown 的相对引用', async () => {
    const report = await lintFixture()

    expect(messagesOf(report, 'packages/a/src/style.css')[0]?.message).toContain('相对路径跨出')
    expect(messagesOf(report, 'packages/a/src/page.html')[0]?.message).toContain('相对路径跨出')
    expect(messagesOf(report, 'packages/a/src/README.md')[0]?.message).toContain('相对路径跨出')
  })

  it('forbid 只作用于配置的 scope', async () => {
    const report = await lintFixture()

    const app = messagesOf(report, 'apps/demo/index.html')
    expect(app[0]?.message).toContain('禁止引用')

    const packageFile = messagesOf(report, 'packages/a/src/index.ts')
    expect(packageFile.some((message) => message.message.includes('禁止引用'))).toBe(false)
  })

  it('无法解析的相对引用归 unresolved，且不影响能解析的 .js / 目录引用', async () => {
    const report = await lintFixture()

    const broken = messagesOf(report, 'packages/a/src/broken.ts')
    expect(broken).toHaveLength(1)
    expect(broken[0]).toMatchObject({ ruleId: 'checks/unresolved', severity: 1 })
    expect(broken[0]?.message).toContain('./missing')

    const index = messagesOf(report, 'packages/a/src/index.ts')
    expect(index.some((message) => message.ruleId === 'checks/unresolved')).toBe(false)
  })

  it('package.json 无法解析时规则失败，不静默跳过', async () => {
    const dir = tempDir()
    fs.mkdirSync(path.join(dir, 'packages/a/src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'packages/a/package.json'), '{ bad')
    fs.writeFileSync(path.join(dir, 'packages/a/src/index.ts'), "import '@acme/x'\n")

    const broken = await createChecker({
      cwd: dir,
      config: {
        roots: ['.'],
        rules: [{ use: 'imports', options: { packageRoots: ['packages/a'], packages: ['@acme/'] } }],
      },
    })

    await expect(broken.lintFiles()).rejects.toMatchObject({
      code: 'RULE',
      message: expect.stringContaining('package.json'),
    })
  })

  it('非法 forbid 正则报配置错误', async () => {
    const broken = await createChecker({
      cwd: process.cwd(),
      config: { rules: [{ use: 'imports', options: { forbid: ['('] } }] },
    })

    await expect(broken.lintText('const a = 1\n', { filePath: 'a.ts' })).rejects.toMatchObject({
      code: 'CONFIG_OPTION',
    })
  })
})
