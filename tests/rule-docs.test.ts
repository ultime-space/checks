import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { runCli } from '../src/cli-run'
import { ruleList } from '../src/rules'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('内置规则文档', () => {
  it('每个内置规则都有文档，且 explain 可读', async () => {
    for (const rule of ruleList()) {
      const file = path.join(ROOT, 'docs/rules', `${rule.name}.md`)
      expect(fs.existsSync(file)).toBe(true)

      const out: string[] = []
      const err: string[] = []
      const code = await runCli(['explain', `checks/${rule.name}`], {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      })
      expect(code).toBe(0)
      expect(err).toEqual([])
      expect(out.join('\n').trim().length).toBeGreaterThan(0)
    }
  })
})
