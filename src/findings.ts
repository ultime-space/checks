import type { CheckMessage, CheckReport, Finding } from './types'

const toMessage = (finding: Finding): CheckMessage => ({
  ruleId: finding.ruleId,
  severity: finding.level === 'error' ? 2 : 1,
  message: finding.message,
  ...(finding.hint === undefined ? {} : { hint: finding.hint }),
  ...(finding.line === undefined ? {} : { line: finding.line }),
  ...(finding.column === undefined ? {} : { column: finding.column }),
})

const compareMessages = (left: CheckMessage, right: CheckMessage): number =>
  (left.line ?? 0) - (right.line ?? 0) ||
  (left.column ?? 0) - (right.column ?? 0) ||
  left.ruleId.localeCompare(right.ruleId) ||
  left.message.localeCompare(right.message)

export function toReport(findings: Finding[]): CheckReport {
  const grouped = new Map<string, CheckMessage[]>()
  for (const finding of findings) {
    const messages = grouped.get(finding.file) ?? []
    messages.push(toMessage(finding))
    grouped.set(finding.file, messages)
  }

  const results = [...grouped.entries()]
    .map(([filePath, messages]) => {
      messages.sort(compareMessages)
      return {
        filePath,
        messages,
        errorCount: messages.filter((message) => message.severity === 2).length,
        warningCount: messages.filter((message) => message.severity === 1).length,
      }
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath))

  return {
    results,
    errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
    warningCount: results.reduce((sum, result) => sum + result.warningCount, 0),
    skipped: [],
  }
}
