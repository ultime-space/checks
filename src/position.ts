export function positionAt(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lastBreak = -1
  for (let cursor = 0; cursor < index; cursor++) {
    if (text[cursor] === '\n') {
      line++
      lastBreak = cursor
    }
  }
  return { line, column: index - lastBreak }
}
