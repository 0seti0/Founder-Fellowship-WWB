import type { GraphEdgeDto, GraphNodeDto, RunProgress } from '@unfold/shared'
import { describe, expect, it } from 'vitest'
import { buildGrowGraph, growKey } from '../lib/growGraph'

function node(id: string, overrides: Partial<GraphNodeDto> = {}): GraphNodeDto {
  return {
    id,
    projectId: 'p',
    type: 'IDEA',
    origin: 'INITIAL_FRAME',
    operator: null,
    runId: 'r1',
    candidateId: `cand-${id}`,
    title: `Title ${id}`,
    summary: '',
    content: {},
    displayPosition: null,
    status: 'VISIBLE',
    userEdited: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as GraphNodeDto
}

function edge(parentId: string, childId: string) {
  return {
    id: `${parentId}-${childId}`,
    projectId: 'p',
    parentId,
    childId,
    runId: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as GraphEdgeDto
}

const source = {
  nodes: [
    node('root', {
      type: 'ROOT_PROMPT',
      runId: null,
      candidateId: null,
      summary: 'How do I know?',
    }),
    node('a', { displayPosition: 1 }),
    node('b', { displayPosition: 2 }),
    node('x', { displayPosition: 3, status: 'REJECTED' }),
  ],
  edges: [edge('root', 'a'), edge('root', 'b'), edge('root', 'x')],
  candidates: [
    { id: 'cand-a', runId: 'r1', ordinal: 1 },
    { id: 'cand-b', runId: 'r1', ordinal: 2 },
    { id: 'cand-x', runId: 'r1', ordinal: 3 },
  ],
}

function progress(overrides: Partial<RunProgress>): RunProgress {
  return {
    stage: 'EXTRACTED',
    facts: [],
    constraints: [],
    candidates: [],
    ...overrides,
  }
}

function candidate(
  ordinal: number,
  selectionState: 'SELECTED' | 'NOT_SELECTED' | null,
) {
  return {
    key: `k${ordinal}`,
    ordinal,
    title: `Child ${ordinal}`,
    distance: null,
    fitRationale: '',
    strongestObjection: '',
    firstTest: '',
    quality: null,
    qualityScore: null,
    constraintEvaluations: [],
    eligibility: null,
    rejectionReasons: [],
    selectionState,
    selectionScore: null,
    displayPosition: null,
  }
}

describe('buildGrowGraph', () => {
  it('shows the root and visible options, keyed by run and ordinal', () => {
    const graph = buildGrowGraph(source, {
      parentId: 'root',
      focusedId: 'b',
      suggestedId: 'a',
      build: null,
    })
    expect(graph.nodes.map((n) => [n.key, n.state])).toEqual([
      ['root', 'root'],
      [growKey('r1', 1), 'option'],
      [growKey('r1', 2), 'option'],
    ])
    expect(graph.nodes.find((n) => n.nodeId === 'b')?.focused).toBe(true)
    expect(graph.nodes.find((n) => n.nodeId === 'a')?.suggested).toBe(true)
    expect(graph.nodes[0]!.title).toBe('How do I know?')
    expect(graph.edges).toHaveLength(2)
    const [root, a] = graph.nodes
    expect(a!.x).toBeGreaterThan(root!.x + root!.width)
  })

  it('streams drafts from the chosen node and marks the chosen path', () => {
    const graph = buildGrowGraph(source, {
      parentId: 'a',
      focusedId: null,
      suggestedId: null,
      build: {
        parentId: 'a',
        runId: 'r2',
        progress: progress({
          drafts: [
            { ordinal: 1, title: 'First', summary: null },
            { ordinal: 2, title: 'Seco', summary: null },
          ],
        }),
      },
    })
    const byKey = new Map(graph.nodes.map((n) => [n.key, n]))
    expect(byKey.get(growKey('r1', 1))).toMatchObject({
      state: 'path',
      building: true,
    })
    expect(byKey.get(growKey('r1', 2))?.state).toBe('other')
    expect(byKey.get(growKey('r2', 1))).toMatchObject({
      state: 'draft',
      writing: false,
    })
    expect(byKey.get(growKey('r2', 2))).toMatchObject({
      state: 'draft',
      writing: true,
      title: 'Seco',
    })
    const pending = graph.edges.filter((e) => e.pending)
    expect(pending.map((e) => [e.from, e.to])).toEqual([
      [growKey('r1', 1), growKey('r2', 1)],
      [growKey('r1', 1), growKey('r2', 2)],
    ])
    expect(graph.edges.find((e) => e.key === 'root-a')?.path).toBe(true)
  })

  it('shows a single placeholder before the first draft arrives', () => {
    const graph = buildGrowGraph(source, {
      parentId: 'a',
      focusedId: null,
      suggestedId: null,
      build: { parentId: 'a', runId: null, progress: null },
    })
    expect(graph.nodes.filter((n) => n.state === 'draft')).toHaveLength(1)
  })

  it('lights partial scores, then settles kept and dropped candidates', () => {
    const scoring = buildGrowGraph(source, {
      parentId: 'a',
      focusedId: null,
      suggestedId: null,
      build: {
        parentId: 'a',
        runId: 'r2',
        progress: progress({
          stage: 'FRAMED',
          candidates: [candidate(1, null), candidate(2, null)],
          partialScores: [
            {
              candidateKey: 'k1',
              scores: { intentCompatibility: 2, decisionUsefulness: 1 },
            },
          ],
        }),
      },
    })
    const first = scoring.nodes.find((n) => n.key === growKey('r2', 1))
    expect(first?.state).toBe('scoring')
    expect(first?.scores).toEqual([2, 1, null, null, null])
    const settled = buildGrowGraph(source, {
      parentId: 'a',
      focusedId: null,
      suggestedId: null,
      build: {
        parentId: 'a',
        runId: 'r2',
        progress: progress({
          stage: 'SELECTED',
          candidates: [candidate(1, 'SELECTED'), candidate(2, 'NOT_SELECTED')],
        }),
      },
    })
    expect(
      settled.nodes.filter((n) => n.key.startsWith('c:r2')).map((n) => n.state),
    ).toEqual(['kept', 'dropped'])
  })
})
