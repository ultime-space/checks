import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createChecker, type ChecksConfig } from '../src/index.ts'
import { runCli, type CliIo } from '../src/cli-run.ts'

const temps: string[] = []

/** 故意传非法形状：绕过类型检查，模拟用户配置文件里的手写错误。 */
const raw = (config: Record<string, unknown>): ChecksConfig => config as unknown as ChecksConfig

const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-config-'))
  temps.push(dir)
  return dir
}

const collector = (cwd: string): { io: CliIo; err: string[] } => {
  const err: string[] = []
  return { io: { cwd, out: () => {}, err: (line) => err.push(line) }, err }
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('配置诊断', () => {
  it('未知顶层字段报 CONFIG_FIELD 与字段路径', async () => {
    await expect(
      createChecker({ cwd: process.cwd(), config: raw({ roots: ['.'], rootz: ['src'] }) }),
    ).rejects.toMatchObject({
      code: 'CONFIG_FIELD',
      path: 'rootz',
    })
  })

  it('规则实例的未知字段给路径', async () => {
    await expect(
      createChecker({ cwd: process.cwd(), config: raw({ rules: [{ use: 'text', optins: {} }] }) }),
    ).rejects.toMatchObject({ code: 'CONFIG_FIELD', path: 'rules[0].optins' })
  })

  it('override 的未知字段给路径', async () => {
    await expect(
      createChecker({
        cwd: process.cwd(),
        config: raw({ overrides: [{ files: ['a.ts'], rules: [], extra: 1 }] }),
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_FIELD', path: 'overrides[0].extra' })
  })

  it('workspace / baseline 类型错误给 CONFIG_FIELD', async () => {
    await expect(createChecker({ cwd: process.cwd(), config: raw({ workspace: 1 }) })).rejects.toMatchObject({
      code: 'CONFIG_FIELD',
      path: 'workspace',
    })
    await expect(createChecker({ cwd: process.cwd(), config: raw({ baseline: 1 }) })).rejects.toMatchObject({
      code: 'CONFIG_FIELD',
      path: 'baseline',
    })
  })

  it('未知规则在创建时给出 CONFIG_RULE 与路径', async () => {
    await expect(createChecker({ cwd: process.cwd(), config: { rules: [{ use: 'nope' }] } })).rejects.toMatchObject({
      code: 'CONFIG_RULE',
      path: 'rules[0].use',
    })
    await expect(
      createChecker({ cwd: process.cwd(), config: { overrides: [{ files: ['a.ts'], rules: [{ use: 'nope' }] }] } }),
    ).rejects.toMatchObject({ code: 'CONFIG_RULE', path: 'overrides[0].rules[0].use' })
  })

  it('非法 options 在运行时给出 CONFIG_OPTION 与规则路径', async () => {
    const checker = await createChecker({
      cwd: process.cwd(),
      config: { rules: [{ use: 'text', options: { deny: 'x' } }] },
    })
    await expect(checker.lintText('const a = 1\n', { filePath: 'a.ts' })).rejects.toMatchObject({
      code: 'CONFIG_OPTION',
      path: 'rules[0].options',
    })
  })

  it('CLI 打印字段路径并以 2 退出', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'checks.config.mjs'), 'export default { rootz: ["src"] }\n')

    const { io, err } = collector(dir)
    expect(await runCli(['run'], io)).toBe(2)
    expect(err.join('\n')).toContain('未知字段：rootz')
    expect(err.join('\n')).toContain('字段：rootz')
  })
})
