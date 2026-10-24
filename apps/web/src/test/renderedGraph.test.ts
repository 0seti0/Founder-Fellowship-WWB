import { describe, expect, it } from 'vitest'
import type { GraphEdgeDto, GraphNodeDto } from '@unfold/shared'
import { buildRenderedGraph } from '../lib/renderedGraph'

function node(id: string, status: GraphNodeDto['status'] = 'VISIBLE') {
  return {
    id,
    projectId: 'project',
    type: 'IDEA',
    origin: 'INITIAL_FRAME',
    operator: null,
    runId: null,
    candidateId: null,
    title: id,
    summary: id,
    content: {},
    displayPosition: 1,
    status,
    userEdited: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } satisfies GraphNodeDto
}

function edge(parentId: string, childId: string): GraphEdgeDto {
  return {
    id: `${parentId}-${childId}`,
    projectId: 'project',
    parentId,
    childId,
    runId: 'run',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('buildRenderedGraph', () => {
  it('keeps a hidden parent as a placeholder when it has a visible child', () => {
    const graph = buildRenderedGraph(
      [node('root'), node('hidden', 'REJECTED'), node('child')],
      [edge('root', 'hidden'), edge('hidden', 'child')],
      false,
    )
    expect(
      graph.nodes.map(({ node, placeholder }) => [node.id, placeholder]),
    ).toEqual([
      ['root', false],
      ['hidden', true],
      ['child', false],
    ])
    expect(graph.edges).toHaveLength(2)
  })

  it('omits hidden leaves', () => {
    const graph = buildRenderedGraph(
      [node('root'), node('leaf', 'ARCHIVED')],
      [edge('root', 'leaf')],
      false,
    )
    expect(graph.nodes.map(({ node }) => node.id)).toEqual(['root'])
    expect(graph.edges).toHaveLength(0)
  })

  it('keeps a chain of hidden ancestors above a visible grandchild', () => {
    const graph = buildRenderedGraph(
      [
        node('root'),
        node('hidden-a', 'REJECTED'),
        node('hidden-b', 'ARCHIVED'),
        node('grandchild'),
      ],
      [
        edge('root', 'hidden-a'),
        edge('hidden-a', 'hidden-b'),
        edge('hidden-b', 'grandchild'),
      ],
      false,
    )
    expect(graph.nodes.filter(({ placeholder }) => placeholder)).toHaveLength(2)
    expect(graph.edges).toHaveLength(3)
  })

  it('renders all hidden nodes as full cards when reveal is enabled', () => {
    const graph = buildRenderedGraph(
      [node('hidden', 'REJECTED'), node('leaf', 'ARCHIVED')],
      [edge('hidden', 'leaf')],
      true,
    )
    expect(graph.nodes.every(({ placeholder }) => !placeholder)).toBe(true)
    expect(graph.edges).toHaveLength(1)
  })
})
