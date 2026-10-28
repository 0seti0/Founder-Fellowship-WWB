import type { GraphEdgeDto, GraphNodeDto } from '@unfold/shared'
import { describe, expect, it } from 'vitest'
import { forkOptions, pathTo, pickOperator } from '../lib/forks'

function node(id: string, overrides: Partial<GraphNodeDto> = {}): GraphNodeDto {
  return {
    id,
    projectId: 'p',
    type: 'IDEA',
    origin: 'INITIAL_FRAME',
    operator: null,
    runId: 'r1',
    candidateId: null,
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

function edge(
  parentId: string,
  childId: string,
  at = '2026-01-01T00:00:00.000Z',
) {
  return {
    id: `${parentId}-${childId}`,
    projectId: 'p',
    parentId,
    childId,
    runId: 'r1',
    createdAt: at,
  } as GraphEdgeDto
}

const nodes = [
  node('root', { type: 'ROOT_PROMPT', runId: null }),
  node('a', { displayPosition: 2 }),
  node('b', { displayPosition: 1 }),
  node('c', { displayPosition: 3, status: 'REJECTED' }),
  node('a1', {
    runId: 'r2',
    displayPosition: 1,
    createdAt: '2026-01-02T00:00:00.000Z',
  }),
]
const edges = [
  edge('root', 'a'),
  edge('root', 'b'),
  edge('root', 'c'),
  edge('a', 'a1'),
]

describe('forkOptions', () => {
  it('lists visible children by display position and marks the first as suggested', () => {
    const options = forkOptions('root', { nodes, edges, candidates: [] })
    expect(options.map((option) => option.nodeId)).toEqual(['b', 'a'])
    expect(options.map((option) => option.suggested)).toEqual([true, false])
  })
})

describe('pathTo', () => {
  it('walks parents back to the prompt', () => {
    expect(pathTo('a1', { nodes, edges }).map((item) => item.id)).toEqual([
      'root',
      'a',
      'a1',
    ])
  })
})

describe('pickOperator', () => {
  it('prefers the suggested eligible operator and never auto-picks INVERT', () => {
    expect(
      pickOperator([
        { operator: 'INVERT', eligible: true, suggested: true },
        { operator: 'GROUND', eligible: true, suggested: false },
      ]),
    ).toBe('GROUND')
    expect(
      pickOperator([
        { operator: 'GROUND', eligible: true, suggested: false },
        { operator: 'LEAP', eligible: true, suggested: true },
      ]),
    ).toBe('LEAP')
    expect(
      pickOperator([{ operator: 'LEAP', eligible: false, suggested: true }]),
    ).toBeNull()
  })
})
