import type { GraphEdgeDto, GraphNodeDto } from '@unfold/shared'

export type RenderedGraphNode = {
  node: GraphNodeDto
  placeholder: boolean
}

export function buildRenderedGraph(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  reveal: boolean,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, string[]>()
  for (const edge of edges)
    children.set(edge.parentId, [
      ...(children.get(edge.parentId) ?? []),
      edge.childId,
    ])

  const memo = new Map<string, boolean>()
  const hasVisibleDescendant = (
    nodeId: string,
    visiting = new Set<string>(),
  ) => {
    const known = memo.get(nodeId)
    if (known !== undefined) return known
    if (visiting.has(nodeId)) return false
    visiting.add(nodeId)
    const result = (children.get(nodeId) ?? []).some((childId) => {
      const child = byId.get(childId)
      if (!child) return false
      if (child.status !== 'REJECTED' && child.status !== 'ARCHIVED')
        return true
      return hasVisibleDescendant(childId, visiting)
    })
    visiting.delete(nodeId)
    memo.set(nodeId, result)
    return result
  }

  const renderedNodes = nodes.flatMap<RenderedGraphNode>((node) => {
    const hidden = node.status === 'REJECTED' || node.status === 'ARCHIVED'
    if (!hidden || reveal) return [{ node, placeholder: false }]
    return hasVisibleDescendant(node.id) ? [{ node, placeholder: true }] : []
  })
  const renderedIds = new Set(renderedNodes.map(({ node }) => node.id))
  return {
    nodes: renderedNodes,
    edges: edges.filter(
      (edge) => renderedIds.has(edge.parentId) && renderedIds.has(edge.childId),
    ),
  }
}
