import { describe, expect, it } from 'vitest'
import { layoutWithDagre } from '../lib/layout'

const nodes = [
  { id: 'parent', data: { label: 'Parent' }, position: { x: 0, y: 0 } },
  { id: 'child', data: { label: 'Child' }, position: { x: 0, y: 0 } },
]
const edges = [{ id: 'parent-child', source: 'parent', target: 'child' }]

describe('layoutWithDagre', () => {
  it('assigns positions and places the parent above its child', () => {
    const positioned = layoutWithDagre(nodes, edges)
    expect(positioned.every((node) => Number.isFinite(node.position.x))).toBe(
      true,
    )
    expect(positioned[0]!.position.y).toBeLessThan(positioned[1]!.position.y)
  })

  it('returns deterministic positions without mutating its input', () => {
    const first = layoutWithDagre(nodes, edges)
    const second = layoutWithDagre(nodes, edges)
    expect(first.map((node) => node.position)).toEqual(
      second.map((node) => node.position),
    )
    expect(nodes[0]!.position).toEqual({ x: 0, y: 0 })
  })
})
