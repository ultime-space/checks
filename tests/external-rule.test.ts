import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { runCli, type CliIo } from '../src/cli-run.ts'
import { createChecker } from '../src/index.ts'
import type { Rule } from '../src/types.ts'

const sampleRule = (id = 'fixture/sample', message = '外部规则命中', line = 1): Rule => ({
  name: 'sample',
  id,
  description: '测试用外部规则',
  run: (ctx) =>
    ctx.files.map((file) => ({
      ruleId: 'ignored/rule-id',
      level: 'error' as const,
      file,
      line,
      message,
    })),
})

const checkerWith = (rules: unknown[], overrides?: unknown[]) =>
  createChecker({
    cwd: process.cwd(),
    baseline: false,
    config: { rules, ...(overrides ? { overrides } : {}) } as never,
  })

describe('外部规则（use: Rule）', () => {
  it('执行 Rule 对象并按 id 输出 finding', async () => {
    const checker = await checkerWith([{ use: sampleRule() }])
    const report = await checker.lintText('const a = 1\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(1)
    expect(report.results[0]?.messages[0]).toMatchObject({
      ruleId: 'fixture/sample',
      severity: 2,
      line: 1,
      message: '外部规则命中',
    })
  })

  it('两个 Rule 对象分别执行，不因函数序列化被合并', async () => {
    const checker = await checkerWith([{ use: sampleRule('fixture/a', 'A') }, { use: sampleRule('fixture/b', 'B') }])
    const report = await checker.lintText('const a = 1\n', { filePath: 'a.ts' })

    expect(report.errorCount).toBe(2)
    expect(report.results[0]?.messages.map((message) => message.ruleId).sort()).toEqual(['fixture/a', 'fixture/b'])
  })

  it('overrides 按规则 id 合并外部规则', async () => {
    const rule = sampleRule()
    const checker = await checkerWith(
      [{ use: rule }],
      [{ files: ['docs/**'], rules: [{ use: rule, severity: 'warn' }] }],
    )

    const docs = await checker.lintText('a\n', { filePath: 'docs/a.ts' })
    expect(docs.errorCount).toBe(0)
    expect(docs.warningCount).toBe(1)

    const src = await checker.lintText('a\n', { filePath: 'src/a.ts' })
    expect(src.errorCount).toBe(1)
  })

  it('外部规则支持行内抑制与通配符', async () => {
    const checker = await checkerWith([{ use: sampleRule('fixture/sample', '外部规则命中', 2) }])
    const named = await checker.lintText('// checks-ignore-next-line fixture/sample reason="测试"\nconst a = 1\n', {
      filePath: 'a.ts',
    })
    expect(named.errorCount).toBe(0)
    expect(named.suppressedCount).toBe(1)

    const wildcard = await checker.lintText('// checks-ignore-next-line * reason="测试"\nconst a = 1\n', {
      filePath: 'a.ts',
    })
    expect(wildcard.errorCount).toBe(0)
    expect(wildcard.suppressedCount).toBe(1)
  })

  it('外部规则抛 CONFIG 错误时映射为 CONFIG_OPTION', async () => {
    const rule: Rule = {
      name: 'sample',
      id: 'fixture/sample',
      description: '测试用外部规则',
      run: () => {
        throw Object.assign(new Error('缺少 manifest'), { code: 'CONFIG' })
      },
    }
    const checker = await checkerWith([{ use: rule }])
    await expect(checker.lintText('a\n', { filePath: 'a.ts' })).rejects.toMatchObject({
      code: 'CONFIG_OPTION',
      message: '缺少 manifest',
    })
  })

  it('外部规则声明 optionKeys 后拒绝未知选项', async () => {
    const rule: Rule = { ...sampleRule(), optionKeys: ['scope'] }
    const checker = await checkerWith([{ use: rule, options: { nope: true } }])
    await expect(checker.lintText('a\n', { filePath: 'a.ts' })).rejects.toMatchObject({
      code: 'CONFIG_OPTION',
      message: 'sample 不支持选项：nope（可用：scope）',
    })
  })

  it('Rule 对象形状或命名空间不合法时报 CONFIG_FIELD', async () => {
    await expect(checkerWith([{ use: { name: 'sample', description: 'x', run: () => [] } }])).rejects.toMatchObject({
      code: 'CONFIG_FIELD',
      path: 'rules[0].use.id',
    })

    await expect(checkerWith([{ use: sampleRule('checks/fake') }])).rejects.toMatchObject({
      code: 'CONFIG_FIELD',
      path: 'rules[0].use.id',
    })

    await expect(checkerWith([{ use: { name: 'sample', description: 'x' } }])).rejects.toMatchObject({
      code: 'CONFIG_FIELD',
      path: 'rules[0].use',
    })
  })

  it('同一组里重复的外部规则 ID 报 CONFIG_RULE', async () => {
    await expect(checkerWith([{ use: sampleRule() }, { use: sampleRule() }])).rejects.toMatchObject({
      code: 'CONFIG_RULE',
      message: '重复的外部规则 ID：fixture/sample',
    })
  })

  it('外部规则复用 ctx.match 的 glob 语义', async () => {
    const matchRule: Rule = {
      name: 'match',
      id: 'fixture/match',
      description: '测试 ctx.match',
      run: (ctx) =>
        ctx.files
          .filter((file) => ctx.match('src/**', file))
          .map((file) => ({ ruleId: 'fixture/match', level: 'error' as const, file, line: 1, message: '命中' })),
    }
    const checker = await checkerWith([{ use: matchRule }])

    expect((await checker.lintText('a\n', { filePath: 'src/a.ts' })).errorCount).toBe(1)
    expect((await checker.lintText('a\n', { filePath: 'docs/a.ts' })).errorCount).toBe(0)
  })

  it('内置规则字符串仍可用', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      baseline: false,
      config: { rules: [{ use: 'text', options: { deny: ['内部'] } }] },
    })
    const report = await checker.lintText('// 内部\n', { filePath: 'a.ts' })
    expect(report.results[0]?.messages[0]?.ruleId).toBe('checks/text')
  })

  it('--rule / --ignore-rule 接受外部规则 ID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-external-'))
    const io = (): CliIo => ({ cwd: dir, out: () => {}, err: () => {} })

    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), 'const a = 1\n')
      fs.writeFileSync(
        path.join(dir, 'rule.mjs'),
        'export const rule = {\n' +
          "  name: 'sample',\n" +
          "  id: 'fixture/sample',\n" +
          "  description: '测试用外部规则',\n" +
          "  run: (ctx) => ctx.files.map((file) => ({ ruleId: 'ignored', level: 'error', file, line: 1, message: '命中' })),\n" +
          '}\n',
      )
      fs.writeFileSync(
        path.join(dir, 'checks.config.mjs'),
        "import { rule } from './rule.mjs'\nexport default { roots: ['.'], rules: [{ use: rule }] }\n",
      )

      expect(await runCli(['run', '--rule', 'fixture/sample'], io())).toBe(1)
      expect(await runCli(['run', '--rule', 'checks/text'], io())).toBe(0)
      expect(await runCli(['run', '--ignore-rule', 'fixture/sample'], io())).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
