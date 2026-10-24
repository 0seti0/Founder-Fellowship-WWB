import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

export function layoutWithDagre<N extends Node>(
  nodes: N[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): N[] {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: direction, nodesep: 64, ranksep: 88 })

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: node.width ?? 172,
      height: node.height ?? 52,
    })
  })
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target))
  dagre.layout(graph)

  return nodes.map((node) => {
    const position = graph.node(node.id)
    const width = node.width ?? 172
    const height = node.height ?? 52
    return {
      ...node,
      position: {
        x: position.x - width / 2,
        y: position.y - height / 2,
      },
    }
  })
}
