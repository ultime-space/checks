import { extname } from 'node:path'
import { ChecksError } from '../config'
import { extractImports } from '../imports'
import type { Finding, Rule, RuleContext } from '../types'

interface Edge {
  to: string
  line: number
}

/** 只对代码图找环；Markdown / HTML 的链接不是模块依赖。 */
const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.css',
  '.scss',
  '.sass',
  '.less',
])

const parseBoolean = (value: unknown, field: string, fallback: boolean): boolean => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new ChecksError(`cycles.${field} 必须是布尔值`, 'CONFIG')
  return value
}

async function buildGraph(ctx: RuleContext, ignoreTypeOnly: boolean): Promise<Map<string, Edge[]>> {
  const files = ctx.files.filter((file) => CODE_EXT.has(extname(file).toLowerCase()))
  const nodes = new Set(files)
  const graph = new Map<string, Edge[]>()

  for (const file of files) {
    const edges: Edge[] = []
    for (const ref of extractImports(ctx.read(file), file)) {
      if (ignoreTypeOnly && ref.typeOnly) continue
      const target = await ctx.resolve(ref.specifier, file)
      if (!target || !nodes.has(target)) continue
      edges.push({ to: target, line: ref.line })
    }
    edges.sort((left, right) => left.to.localeCompare(right.to) || left.line - right.line)
    graph.set(file, edges)
  }

  return graph
}

/** Tarjan：返回全部强连通分量，顺序稳定。 */
function stronglyConnected(graph: Map<string, Edge[]>): string[][] {
  let nextIndex = 0
  const indices = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (node: string): void => {
    const current = nextIndex++
    indices.set(node, current)
    low.set(node, current)
    stack.push(node)
    onStack.add(node)

    for (const edge of graph.get(node) ?? []) {
      const known = indices.get(edge.to)
      if (known === undefined) {
        visit(edge.to)
        low.set(node, Math.min(low.get(node) ?? current, low.get(edge.to) ?? current))
      } else if (onStack.has(edge.to)) {
        low.set(node, Math.min(low.get(node) ?? current, known))
      }
    }

    if (low.get(node) !== current) return

    const component: string[] = []
    let member = stack.pop()
    while (member !== undefined) {
      onStack.delete(member)
      component.push(member)
      if (member === node) break
      member = stack.pop()
    }
    components.push(component)
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node)
  }

  return components
}

function hasSelfEdge(graph: Map<string, Edge[]>, component: string[]): boolean {
  const [only] = component
  if (!only || component.length !== 1) return false
  return (graph.get(only) ?? []).some((edge) => edge.to === only)
}

/** 从代表节点出发找一条最短环，保证消息稳定。 */
function shortestCycle(graph: Map<string, Edge[]>, component: string[], start: string): string[] {
  const allowed = new Set(component)
  const queue: string[][] = [[start]]
  const visited = new Set<string>([start])

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const last = current[current.length - 1]
    if (!last) continue

    for (const edge of graph.get(last) ?? []) {
      if (!allowed.has(edge.to)) continue
      if (edge.to === start) return [...current, start]
      if (visited.has(edge.to)) continue
      visited.add(edge.to)
      queue.push([...current, edge.to])
    }
  }

  return [start, start]
}

export const cyclesRule: Rule = {
  name: 'cycles',
  description: '基于相对引用图找环（可选规则，默认关闭）',
  async run(ctx, rawOptions) {
    const ignoreTypeOnly = parseBoolean(rawOptions.ignoreTypeOnly, 'ignoreTypeOnly', false)
    const graph = await buildGraph(ctx, ignoreTypeOnly)
    const findings: Finding[] = []

    for (const component of stronglyConnected(graph)) {
      if (component.length === 1 && !hasSelfEdge(graph, component)) continue

      const sorted = [...component].sort()
      const start = sorted[0]
      if (!start) continue

      const cycle = shortestCycle(graph, sorted, start)
      const next = cycle[1]
      const line = next ? (graph.get(start)?.find((edge) => edge.to === next)?.line ?? 1) : 1

      findings.push({
        ruleId: 'checks/cycles',
        level: 'error',
        file: start,
        line,
        column: 1,
        message: `循环依赖：${cycle.join(' → ')}`,
        hint: '拆出共享模块，或改用依赖注入',
      })
    }

    return findings
  },
}
