import {
  IdeaContentSchema,
  type CandidateDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type UnaryOperator,
} from '@unfold/shared'

export type ForkOption = {
  nodeId: string
  title: string
  assumption: string | null
  fitRationale: string
  strongestObjection: string
  firstTest: string
  suggested: boolean
}

type GraphSource = {
  nodes: GraphNodeDto[]
  edges: GraphEdgeDto[]
  candidates: Pick<CandidateDto, 'id' | 'displayPosition'>[]
}

const HIDDEN = new Set(['REJECTED', 'ARCHIVED'])

export function forkOptions(
  parentId: string,
  graph: GraphSource,
): ForkOption[] {
  const childIds = new Set(
    graph.edges
      .filter((edge) => edge.parentId === parentId)
      .map((edge) => edge.childId),
  )
  const children = graph.nodes
    .filter(
      (node) =>
        childIds.has(node.id) &&
        node.type === 'IDEA' &&
        !HIDDEN.has(node.status),
    )
    .sort(
      (a, b) =>
        (a.displayPosition ?? Number.MAX_SAFE_INTEGER) -
          (b.displayPosition ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    )
  const latestRun = children.reduce<string | null>(
    (latest, node) =>
      latest === null ||
      node.createdAt >
        (children.find((item) => item.runId === latest)?.createdAt ?? '')
        ? node.runId
        : latest,
    null,
  )
  let suggestedGiven = false
  return children.map((node) => {
    const parsed = IdeaContentSchema.safeParse(node.content)
    const content = parsed.success ? parsed.data : null
    const suggested =
      !suggestedGiven &&
      node.runId === latestRun &&
      node.displayPosition !== null
    if (suggested) suggestedGiven = true
    return {
      nodeId: node.id,
      title: node.title,
      assumption: content?.changedAssumptions[0] ?? null,
      fitRationale: content?.fitRationale ?? '',
      strongestObjection: content?.strongestObjection ?? '',
      firstTest: content?.firstTest ?? '',
      suggested,
    }
  })
}

export function pathTo(
  nodeId: string,
  graph: Pick<GraphSource, 'nodes' | 'edges'>,
): GraphNodeDto[] {
  const path: GraphNodeDto[] = []
  const seen = new Set<string>()
  let current = graph.nodes.find((node) => node.id === nodeId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    const parentEdge = graph.edges
      .filter((edge) => edge.childId === current!.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    current = parentEdge
      ? graph.nodes.find((node) => node.id === parentEdge.parentId)
      : undefined
  }
  return path
}

export function pickOperator(
  options: Array<{
    operator: UnaryOperator
    eligible: boolean
    suggested: boolean
  }>,
): UnaryOperator | null {
  const usable = options.filter(
    (option) => option.eligible && option.operator !== 'INVERT',
  )
  return (
    usable.find((option) => option.suggested)?.operator ??
    usable[0]?.operator ??
    null
  )
}
