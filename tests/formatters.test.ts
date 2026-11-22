import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { runCli, type CliIo } from '../src/cli-run.ts'

const temps: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-format-'))
  temps.push(dir)
  return dir
}

const collector = (cwd: string, color?: boolean): { io: CliIo; out: string[]; err: string[] } => {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      cwd,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      ...(color === undefined ? {} : { color }),
    },
    out,
    err,
  }
}

const setup = (): string => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
  fs.writeFileSync(
    path.join(dir, 'checks.config.mjs'),
    "export default { roots: ['a.ts'], rules: [{ use: 'text', options: { deny: ['内部'] } }] }\n",
  )
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('formatter', () => {
  it('text 输出包含片段、规则入口与汇总', async () => {
    const { io, out, err } = collector(setup())
    expect(await runCli(['run'], io)).toBe(1)
    expect(err).toEqual([])
    expect(out.join('\n')).toBe(
      [
        'a.ts',
        '  1:4  error  checks/text  禁止出现：内部',
        '           hint: 删除或改写该片段',
        '      1 │ // 内部',
        '        │    ^^',
        '    · 规则说明：ultime-checks explain checks/text',
        '',
        '1 个文件命中 / 1 error / 0 warnings',
      ].join('\n'),
    )
  })

  it('颜色由 io.color 控制，默认无色', async () => {
    const colored = collector(setup(), true)
    expect(await runCli(['run'], colored.io)).toBe(1)
    expect(colored.out.join('\n')).toContain('\u001b[')

    const plain = collector(setup(), false)
    expect(await runCli(['run'], plain.io)).toBe(1)
    expect(plain.out.join('\n')).not.toContain('\u001b[')
  })

  it('抑制摘要只输出一次', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// checks-ignore-next-line checks/text reason="demo"\n// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['a.ts'], rules: [{ use: 'text', options: { deny: ['内部'] } }] }\n",
    )

    const { io, out, err } = collector(dir)
    expect(await runCli(['run'], io)).toBe(0)
    expect(err).toEqual([])
    expect(out.join('\n').match(/行内抑制/g)).toHaveLength(1)
  })

  it('--max-warnings 超预算时说明原因', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['a.ts'], rules: [{ use: 'text', severity: 'warn', options: { deny: ['内部'] } }] }\n",
    )

    const { io, out, err } = collector(dir)
    expect(await runCli(['run', '--max-warnings', '0'], io)).toBe(1)
    expect(err).toEqual([])
    expect(out.join('\n')).toContain('warning 超预算：1 > --max-warnings 0')
  })

  it('--quiet 隐藏的 warning 仍计入汇总', async () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'a.ts'), '// 内部\n')
    fs.writeFileSync(
      path.join(dir, 'checks.config.mjs'),
      "export default { roots: ['a.ts'], rules: [{ use: 'text', severity: 'warn', options: { deny: ['内部'] } }] }\n",
    )

    const { io, out } = collector(dir)
    expect(await runCli(['run', '--quiet', '--max-warnings', '0'], io)).toBe(1)
    const text = out.join('\n')
    expect(text).toContain('--quiet 隐藏 1 条 warning')
    expect(text).toContain('1 个文件命中 / 0 error / 1 warnings')
    expect(text).not.toContain('✓ checks passed')
  })

  it('--format sarif 输出 SARIF 2.1.0', async () => {
    const { io, out } = collector(setup())
    expect(await runCli(['run', '--format', 'sarif'], io)).toBe(1)

    const sarif = JSON.parse(out.join('\n')) as {
      version: string
      runs: { results: { ruleId: string; level: string; partialFingerprints: Record<string, string> }[] }[]
    }
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe('checks/text')
    expect(sarif.runs[0]?.results[0]?.level).toBe('error')
    expect(sarif.runs[0]?.results[0]?.partialFingerprints.primaryLocationLineHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('--format github 输出注解', async () => {
    const { io, out } = collector(setup())
    expect(await runCli(['run', '--format', 'github'], io)).toBe(1)
    expect(out.join('\n')).toContain('::error file=a.ts,line=1,col=')
  })

  it('--format 可以加载自定义模块', async () => {
    const dir = setup()
    fs.writeFileSync(
      path.join(dir, 'fmt.mjs'),
      'export default (results, meta) => `custom:${results.length}:${meta.toolVersion}`\n',
    )

    const { io, out } = collector(dir)
    expect(await runCli(['run', '--format', './fmt.mjs'], io)).toBe(1)
    expect(out.join('\n')).toMatch(/^custom:1:\d+\.\d+\.\d+$/)
  })

  it('formatter 加载失败时退出码 2', async () => {
    const { io, err } = collector(setup())
    expect(await runCli(['run', '--format', './missing.mjs'], io)).toBe(2)
    expect(err.join('\n')).toContain('无法加载 formatter')
  })
})
