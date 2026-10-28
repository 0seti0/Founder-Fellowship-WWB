import dagre from '@dagrejs/dagre'
import type {
  CandidateDto,
  GraphEdgeDto,
  GraphNodeDto,
  RunProgress,
} from '@unfold/shared'
import { pathTo } from './forks'

export type GrowNodeState =
  | 'root'
  | 'path'
  | 'option'
  | 'other'
  | 'draft'
  | 'scoring'
  | 'kept'
  | 'dropped'

export type GrowNode = {
  key: string
  nodeId: string | null
  title: string
  state: GrowNodeState
  focused: boolean
  suggested: boolean
  building: boolean
  writing: boolean
  scores: Array<number | null> | null
  x: number
  y: number
  width: number
  height: number
}

export type GrowEdge = {
  key: string
  from: string
  to: string
  path: boolean
  pending: boolean
}

export type GrowLayout = {
  nodes: GrowNode[]
  edges: GrowEdge[]
  width: number
  height: number
}

export type GrowBuild = {
  parentId: string
  runId: string | null
  progress: RunProgress | null
}

type GrowSource = {
  nodes: GraphNodeDto[]
  edges: GraphEdgeDto[]
  candidates: Pick<CandidateDto, 'id' | 'runId' | 'ordinal'>[]
}

export const ROOT_SIZE = { width: 300, height: 96 }
export const IDEA_SIZE = { width: 270, height: 92 }

const CRITERIA = [
  'intentCompatibility',
  'decisionUsefulness',
  'specificityCoherence',
  'firstTestExecutability',
  'nonObviousness',
] as const

const HIDDEN = new Set(['REJECTED', 'ARCHIVED'])

export function growKey(runId: string, ordinal: number) {
  return `c:${runId}:${ordinal}`
}

type Pending = Omit<GrowNode, 'x' | 'y' | 'width' | 'height'>

export function buildGrowGraph(
  source: GrowSource,
  options: {
    parentId: string
    focusedId: string | null
    suggestedId: string | null
    build: GrowBuild | null
  },
): GrowLayout {
  const visible = source.nodes
    .filter(
      (node) =>
        node.type === 'ROOT_PROMPT' ||
        (node.type === 'IDEA' && !HIDDEN.has(node.status)),
    )
    .sort(
      (a, b) =>
        Number(b.type === 'ROOT_PROMPT') - Number(a.type === 'ROOT_PROMPT') ||
        a.createdAt.localeCompare(b.createdAt) ||
        (a.displayPosition ?? Number.MAX_SAFE_INTEGER) -
          (b.displayPosition ?? Number.MAX_SAFE_INTEGER),
    )
  const candidateById = new Map(
    source.candidates.map((item) => [item.id, item]),
  )
  const keyOf = new Map<string, string>()
  for (const node of visible) {
    const candidate = node.candidateId
      ? candidateById.get(node.candidateId)
      : undefined
    keyOf.set(
      node.id,
      node.type === 'IDEA' && candidate
        ? growKey(candidate.runId, candidate.ordinal)
        : node.id,
    )
  }
  const pathIds = new Set(pathTo(options.parentId, source).map((n) => n.id))
  const optionIds = new Set(
    source.edges
      .filter((edge) => edge.parentId === options.parentId)
      .map((edge) => edge.childId),
  )

  const pending: Pending[] = visible.map((node) => ({
    key: keyOf.get(node.id)!,
    nodeId: node.id,
    title:
      node.type === 'ROOT_PROMPT' ? node.summary || node.title : node.title,
    state:
      node.type === 'ROOT_PROMPT'
        ? 'root'
        : pathIds.has(node.id)
          ? 'path'
          : optionIds.has(node.id) && !options.build
            ? 'option'
            : 'other',
    focused: !options.build && node.id === options.focusedId,
    suggested: !options.build && node.id === options.suggestedId,
    building: options.build?.parentId === node.id,
    writing: false,
    scores: null,
  }))
  const edges: GrowEdge[] = source.edges
    .filter((edge) => keyOf.has(edge.parentId) && keyOf.has(edge.childId))
    .map((edge) => ({
      key: edge.id,
      from: keyOf.get(edge.parentId)!,
      to: keyOf.get(edge.childId)!,
      path: pathIds.has(edge.parentId) && pathIds.has(edge.childId),
      pending: false,
    }))

  const build = options.build
  const buildFrom = build ? keyOf.get(build.parentId) : undefined
  if (build && buildFrom) {
    const existing = new Set(pending.map((node) => node.key))
    for (const node of buildNodes(build)) {
      if (existing.has(node.key)) continue
      pending.push(node)
      edges.push({
        key: `e:${node.key}`,
        from: buildFrom,
        to: node.key,
        path: false,
        pending: true,
      })
    }
  }
  return layout(pending, edges)
}

function buildNodes(build: GrowBuild): Pending[] {
  const progress = build.progress
  const base = {
    nodeId: null,
    focused: false,
    suggested: false,
    building: false,
    writing: false,
    scores: null,
  }
  const runId = build.runId ?? 'pending'
  if (
    !progress ||
    progress.stage === 'STARTED' ||
    progress.stage === 'EXTRACTED'
  ) {
    const drafts = progress?.drafts ?? []
    if (!drafts.length)
      return [
        {
          ...base,
          key: `pending:${runId}`,
          title: '',
          state: 'draft',
          writing: true,
        },
      ]
    return drafts.map((draft, index) => ({
      ...base,
      key: growKey(runId, draft.ordinal),
      title: draft.title,
      state: 'draft',
      writing: index === drafts.length - 1,
    }))
  }
  const partial = new Map(
    (progress.partialScores ?? []).map((item) => [
      item.candidateKey,
      item.scores,
    ]),
  )
  return progress.candidates.map((candidate) => {
    const quality = candidate.quality
    const scores =
      quality && 'criteria' in quality
        ? CRITERIA.map((key) => quality.criteria[key].score)
        : partial.has(candidate.key)
          ? CRITERIA.map((key) => partial.get(candidate.key)![key] ?? null)
          : CRITERIA.map(() => null)
    const settled = progress.stage === 'SELECTED' && candidate.selectionState
    return {
      ...base,
      key: growKey(runId, candidate.ordinal),
      title: candidate.title,
      state: settled
        ? candidate.selectionState === 'SELECTED'
          ? 'kept'
          : 'dropped'
        : 'scoring',
      scores,
    }
  })
}

function layout(pending: Pending[], edges: GrowEdge[]): GrowLayout {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 20,
    ranksep: 84,
    marginx: 0,
    marginy: 0,
  })
  for (const node of pending) {
    const size = node.state === 'root' ? ROOT_SIZE : IDEA_SIZE
    graph.setNode(node.key, { ...size })
  }
  for (const edge of edges) graph.setEdge(edge.from, edge.to)
  dagre.layout(graph)
  let width = 0
  let height = 0
  const nodes = pending.map((node) => {
    const size = node.state === 'root' ? ROOT_SIZE : IDEA_SIZE
    const point = graph.node(node.key)
    const x = point.x - size.width / 2
    const y = point.y - size.height / 2
    width = Math.max(width, x + size.width)
    height = Math.max(height, y + size.height)
    return { ...node, x, y, ...size }
  })
  return { nodes, edges, width, height }
}
