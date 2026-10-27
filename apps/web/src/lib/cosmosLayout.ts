export type CosmosStatus = 'VISIBLE' | 'PINNED' | 'REJECTED' | 'ARCHIVED'

export type CosmosNodeInput = {
  id: string
  type: string
  status: CosmosStatus
  operator: string | null
  distance: string | null
  placeholder?: boolean
}

export type CosmosEdgeInput = {
  id: string
  parentId: string
  childId: string
  createdAt: string
}

export type CosmosBody = {
  id: string
  kind: 'core' | 'planet' | 'moon' | 'seed-system'
  parentId: string | null
  operator: string | null
  status: CosmosStatus
  placeholder: boolean
  position: [number, number, number]
  radius: number
  color: string
  emissive: number
}

export const RING_RADIUS: Record<string, number> = {
  near: 4,
  adjacent: 6.5,
  leap: 9,
}
const MOON_RADIUS: Record<string, number> = {
  near: 1.6,
  adjacent: 2.4,
  leap: 3.4,
}

export const OPERATOR_COLORS: Record<string, string> = {
  GROUND: '#8fbf5a',
  REFRAME: '#6aa5ff',
  LEAP: '#b98cff',
  INVERT: '#ff7a5c',
  TRANSPLANT: '#3fd1c1',
}
const PLANET_PALETTE = [
  '#f2c96d',
  '#ff9fb8',
  '#7fd8ff',
  '#c9a7ff',
  '#9ff0b5',
  '#ffb37a',
]

export function stableAngle(id: string) {
  let hash = 2166136261
  for (const char of id) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (((hash >>> 0) % 3600) / 3600) * Math.PI * 2
}

export function computeCosmosLayout(
  nodes: CosmosNodeInput[],
  edges: CosmosEdgeInput[],
): CosmosBody[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parentOf = new Map<string, string>()
  const sorted = [...edges].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  )
  for (const edge of sorted)
    if (
      byId.has(edge.parentId) &&
      byId.has(edge.childId) &&
      !parentOf.has(edge.childId)
    )
      parentOf.set(edge.childId, edge.parentId)

  const bodies = new Map<string, CosmosBody>()
  const root = nodes.find((node) => node.type === 'ROOT_PROMPT')
  const resolve = (node: CosmosNodeInput, depth = 0): CosmosBody => {
    const known = bodies.get(node.id)
    if (known) return known
    const parentId = parentOf.get(node.id) ?? null
    const parentNode = parentId ? byId.get(parentId) : undefined
    const angle = stableAngle(node.id)
    const distance = node.distance ?? 'adjacent'
    let body: CosmosBody
    if (node.type === 'ROOT_PROMPT' || !parentNode || depth > 32) {
      body = {
        id: node.id,
        kind: 'core',
        parentId: null,
        operator: null,
        status: node.status,
        placeholder: Boolean(node.placeholder),
        position: [0, 0, 0],
        radius: 1.2,
        color: '#ffd27a',
        emissive: 2.2,
      }
    } else {
      const parent = resolve(parentNode, depth + 1)
      const isInitial = parent.kind === 'core'
      const drift =
        node.status === 'REJECTED' ? 1.25 : node.status === 'ARCHIVED' ? 1.4 : 1
      let center = parent.position
      let orbit = isInitial
        ? (RING_RADIUS[distance] ?? RING_RADIUS.adjacent!)
        : (MOON_RADIUS[distance] ?? MOON_RADIUS.adjacent!)
      let kind: CosmosBody['kind'] = isInitial ? 'planet' : 'moon'
      if (node.operator === 'TRANSPLANT' && !isInitial) {
        const away =
          Math.atan2(parent.position[2], parent.position[0]) +
          (angle - Math.PI) * 0.35
        center = [
          parent.position[0] + Math.cos(away) * 4.5,
          parent.position[1] + 0.8,
          parent.position[2] + Math.sin(away) * 4.5,
        ]
        orbit = 0.9
        kind = 'seed-system'
      }
      if (node.operator === 'GROUND') orbit *= 0.75
      if (node.operator === 'LEAP') orbit *= 1.5
      orbit *= drift
      const tilt = isInitial
        ? Math.sin(angle * 3) * 0.6
        : Math.cos(angle * 2) * 1.1
      const baseRadius = isInitial ? 0.62 : 0.36
      const radius =
        node.operator === 'GROUND'
          ? baseRadius * 0.75
          : node.operator === 'LEAP'
            ? baseRadius * 1.1
            : baseRadius
      const color = node.operator
        ? (OPERATOR_COLORS[node.operator] ?? '#cfd6e6')
        : PLANET_PALETTE[
            Math.floor((angle / (Math.PI * 2)) * PLANET_PALETTE.length)
          ]!
      body = {
        id: node.id,
        kind,
        parentId,
        operator: node.operator,
        status: node.status,
        placeholder: Boolean(node.placeholder),
        position: [
          center[0] + Math.cos(angle) * orbit,
          center[1] + tilt,
          center[2] + Math.sin(angle) * orbit,
        ],
        radius: node.placeholder ? radius * 0.5 : radius,
        color:
          node.status === 'REJECTED'
            ? '#8a5a4e'
            : node.status === 'ARCHIVED'
              ? '#bfe3ff'
              : color,
        emissive:
          node.status === 'PINNED'
            ? 2.6
            : node.status === 'REJECTED'
              ? 0.15
              : node.status === 'ARCHIVED'
                ? 0.35
                : 0.45,
      }
    }
    bodies.set(node.id, body)
    return body
  }
  if (root) resolve(root)
  for (const node of nodes) resolve(node)
  return nodes.map((node) => bodies.get(node.id)!)
}

export function ancestryPath(edges: CosmosEdgeInput[], focusId: string | null) {
  if (!focusId) return []
  const parentOf = new Map<string, string>()
  for (const edge of [...edges].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  ))
    if (!parentOf.has(edge.childId)) parentOf.set(edge.childId, edge.parentId)
  const path = [focusId]
  const seen = new Set(path)
  let cursor = parentOf.get(focusId)
  while (cursor && !seen.has(cursor)) {
    path.unshift(cursor)
    seen.add(cursor)
    cursor = parentOf.get(cursor)
  }
  return path
}
