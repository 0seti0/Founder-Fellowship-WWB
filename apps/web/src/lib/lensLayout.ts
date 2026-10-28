export type LensRole = 'focus' | 'ancestor' | 'sibling' | 'child'

export type LensItem = {
  id: string
  role: LensRole
  x: number
  y: number
  scale: number
  width: number
  height: number
}

export type LensPoint = { x: number; y: number }

export type LensLayout = {
  focusId: string | null
  items: LensItem[]
  thread: LensPoint[]
  links: { from: string; to: string }[]
  parentOf: Map<string, string>
  offstageCount: number
}

type LensNode = { id: string; type: string }
type LensEdge = {
  id: string
  parentId: string
  childId: string
  createdAt: string
}

export const FOCUS_CARD = { width: 340, height: 188 }
export const CARD = { width: 280, height: 128 }
const MAX_SIBLINGS = 2
const MAX_CHILDREN = 6

export function computeLensLayout(
  nodes: LensNode[],
  edges: LensEdge[],
  requestedFocusId: string | null,
  size: { width: number; height: number },
): LensLayout {
  const ids = new Set(nodes.map((node) => node.id))
  const parentOf = new Map<string, string>()
  const sortedEdges = edges
    .filter((edge) => ids.has(edge.parentId) && ids.has(edge.childId))
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
  const children = new Map<string, string[]>()
  for (const edge of sortedEdges) {
    if (!parentOf.has(edge.childId)) parentOf.set(edge.childId, edge.parentId)
    children.set(edge.parentId, [
      ...(children.get(edge.parentId) ?? []),
      edge.childId,
    ])
  }

  const root = nodes.find((node) => node.type === 'ROOT_PROMPT')
  const focusId =
    requestedFocusId && ids.has(requestedFocusId)
      ? requestedFocusId
      : (root?.id ?? nodes[0]?.id ?? null)
  if (!focusId)
    return {
      focusId: null,
      items: [],
      thread: [],
      links: [],
      parentOf,
      offstageCount: 0,
    }

  const ancestors: string[] = []
  const seen = new Set([focusId])
  let cursor = parentOf.get(focusId)
  while (cursor && !seen.has(cursor)) {
    ancestors.push(cursor)
    seen.add(cursor)
    cursor = parentOf.get(cursor)
  }

  const items: LensItem[] = [
    { id: focusId, role: 'focus', x: 0, y: 0, scale: 1, ...FOCUS_CARD },
  ]
  const links: { from: string; to: string }[] = []

  ancestors.forEach((id, index) => {
    const level = index + 1
    items.push({
      id,
      role: 'ancestor',
      x: -150 * level,
      y: -190 - 150 * index,
      scale: Math.max(0.5, 0.78 - 0.08 * index),
      ...CARD,
    })
  })

  const parentId = ancestors[0]
  const siblings = parentId
    ? (children.get(parentId) ?? []).filter((id) => id !== focusId)
    : []
  siblings.slice(0, MAX_SIBLINGS).forEach((id, index) => {
    const side = index % 2 === 0 ? 1 : -1
    const rank = Math.floor(index / 2)
    items.push({
      id,
      role: 'sibling',
      x: side * (FOCUS_CARD.width / 2 + 120 + rank * 200),
      y: 18 + rank * 26,
      scale: 0.62,
      ...CARD,
    })
    links.push({ from: parentId!, to: id })
  })

  const focusChildren = [...(children.get(focusId) ?? [])]
    .reverse()
    .slice(0, MAX_CHILDREN)
  const perRow = focusChildren.length <= 4 ? focusChildren.length : 3
  focusChildren.forEach((id, index) => {
    const row = Math.floor(index / perRow)
    const inRow = Math.min(perRow, focusChildren.length - row * perRow)
    const offset = (index % perRow) - (inRow - 1) / 2
    items.push({
      id,
      role: 'child',
      x: offset * 205,
      y: FOCUS_CARD.height / 2 + 120 + row * 112 + Math.abs(offset) * 16,
      scale: 0.66,
      ...CARD,
    })
    links.push({ from: focusId, to: id })
  })

  const left = Math.min(
    ...items.map((item) => item.x - (item.width * item.scale) / 2),
  )
  const right = Math.max(
    ...items.map((item) => item.x + (item.width * item.scale) / 2),
  )
  const top = Math.min(
    ...items.map((item) => item.y - (item.height * item.scale) / 2),
  )
  const bottom = Math.max(
    ...items.map((item) => item.y + (item.height * item.scale) / 2),
  )
  const padding = 48
  const zoom = Math.min(
    1,
    (size.width - padding * 2) / Math.max(1, right - left),
    (size.height - padding * 2) / Math.max(1, bottom - top),
  )
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  const placed = items.map((item) => ({
    ...item,
    x: (item.x - centerX) * zoom + size.width / 2,
    y: (item.y - centerY) * zoom + size.height / 2,
    scale: item.scale * zoom,
  }))
  const byId = new Map(placed.map((item) => [item.id, item]))
  const thread = [...ancestors]
    .reverse()
    .concat(focusId)
    .map((id) => byId.get(id)!)
    .map(({ x, y }) => ({ x, y }))

  return {
    focusId,
    items: placed,
    thread,
    links,
    parentOf,
    offstageCount: Math.max(0, nodes.length - placed.length),
  }
}

export function curvePath(points: LensPoint[]) {
  if (!points.length) return ''
  const [first, ...rest] = points
  let path = `M ${first!.x.toFixed(1)} ${first!.y.toFixed(1)}`
  let previous = first!
  for (const point of rest) {
    const midY = (previous.y + point.y) / 2
    path += ` C ${previous.x.toFixed(1)} ${midY.toFixed(1)} ${point.x.toFixed(1)} ${midY.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    previous = point
  }
  return path
}
