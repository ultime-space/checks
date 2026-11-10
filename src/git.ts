import { execFileSync } from 'node:child_process'
import { ChecksError } from './config'

const split = (output: string): string[] =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    throw new ChecksError('当前目录不是 git 仓库，或 git 不可用', 'USAGE')
  }
}

/**
 * `--since` 取 ref 到 HEAD 的差异并叠加工作区变更；
 * `--changed` 取工作区与暂存区变更 + 未跟踪文件。
 */
export function changedFiles(cwd: string, since?: string): string[] {
  const args = ['diff', '--name-only', '--relative', '--diff-filter=ACMR']
  const outputs: string[] = []

  if (since) outputs.push(git(cwd, [...args, `${since}...HEAD`]))
  outputs.push(git(cwd, args))
  outputs.push(git(cwd, [...args, '--cached']))
  if (!since) outputs.push(git(cwd, ['ls-files', '--others', '--exclude-standard']))

  return [...new Set(outputs.flatMap(split))].sort()
}
