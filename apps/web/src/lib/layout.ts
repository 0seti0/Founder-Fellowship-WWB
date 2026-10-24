import dagre from '@dagrejs/dagre'
import type { Edge, Node, XYPosition } from '@xyflow/react'

const placementGap = 24

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

export function layoutWithPreservedPositions<N extends Node>(
  nodes: N[],
  edges: Edge[],
  existingPositions: ReadonlyMap<string, XYPosition>,
  compareNewNodes?: (left: N, right: N) => number,
): N[] {
  const layout = layoutWithDagre(nodes, edges)
  if (existingPositions.size === 0) return layout

  const dagrePositions = new Map(layout.map((node) => [node.id, node.position]))
  const placed = new Map<string, N>()
  for (const node of layout) {
    const position = existingPositions.get(node.id)
    if (position) placed.set(node.id, { ...node, position: { ...position } })
  }

  const newNodes = layout
    .filter((node) => !existingPositions.has(node.id))
    .sort(compareNewNodes)

  for (const node of newNodes) {
    const parentEdge = edges.find((edge) => edge.target === node.id)
    const parent = parentEdge ? placed.get(parentEdge.source) : undefined
    const parentDagrePosition = parentEdge
      ? dagrePositions.get(parentEdge.source)
      : undefined
    const nodeDagrePosition = dagrePositions.get(node.id)!
    let position =
      parent && parentDagrePosition
        ? {
            x: parent.position.x + nodeDagrePosition.x - parentDagrePosition.x,
            y: parent.position.y + nodeDagrePosition.y - parentDagrePosition.y,
          }
        : { ...node.position }

    while (true) {
      const paddedNode = {
        x: position.x - placementGap,
        y: position.y - placementGap,
        width: (node.width ?? 172) + placementGap * 2,
        height: (node.height ?? 52) + placementGap * 2,
      }
      let rightmostIntersecting: N | undefined

      for (const placedNode of placed.values()) {
        const placedWidth = placedNode.width ?? 172
        const placedHeight = placedNode.height ?? 52
        const intersects =
          paddedNode.x < placedNode.position.x + placedWidth &&
          paddedNode.x + paddedNode.width > placedNode.position.x &&
          paddedNode.y < placedNode.position.y + placedHeight &&
          paddedNode.y + paddedNode.height > placedNode.position.y
        if (
          intersects &&
          (!rightmostIntersecting ||
            placedNode.position.x + placedWidth >
              rightmostIntersecting.position.x +
                (rightmostIntersecting.width ?? 172))
        ) {
          rightmostIntersecting = placedNode
        }
      }

      if (!rightmostIntersecting) break
      position = {
        ...position,
        x:
          rightmostIntersecting.position.x +
          (rightmostIntersecting.width ?? 172) +
          placementGap,
      }
    }

    placed.set(node.id, { ...node, position })
  }

  return layout.map((node) => placed.get(node.id) ?? node)
}
