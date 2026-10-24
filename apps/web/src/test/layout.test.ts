import { describe, expect, it } from 'vitest'
import { layoutWithDagre, layoutWithPreservedPositions } from '../lib/layout'

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

  it('keeps stored positions and separates successive child batches', () => {
    const parent = {
      id: 'parent',
      data: { label: 'Parent' },
      position: { x: 0, y: 0 },
      width: 100,
      height: 60,
    }
    const firstBatch = ['first-a', 'first-b'].map((id) => ({
      id,
      data: { label: id },
      position: { x: 0, y: 0 },
      width: 100,
      height: 60,
    }))
    const firstEdges = firstBatch.map((node) => ({
      id: `parent-${node.id}`,
      source: parent.id,
      target: node.id,
    }))
    const positions = new Map([['parent', { x: 300, y: 100 }]])
    const firstLayout = layoutWithPreservedPositions(
      [parent, ...firstBatch],
      firstEdges,
      positions,
    )
    firstLayout.forEach((node) => positions.set(node.id, node.position))
    const firstPositions = new Map(positions)

    const secondBatch = ['second-a', 'second-b'].map((id) => ({
      id,
      data: { label: id },
      position: { x: 0, y: 0 },
      width: 100,
      height: 60,
    }))
    const allNodes = [parent, ...firstBatch, ...secondBatch]
    const allEdges = [
      ...firstEdges,
      ...secondBatch.map((node) => ({
        id: `parent-${node.id}`,
        source: parent.id,
        target: node.id,
      })),
    ]
    const secondLayout = layoutWithPreservedPositions(
      allNodes,
      allEdges,
      positions,
    )

    for (const node of [...firstBatch, parent]) {
      expect(
        secondLayout.find((item) => item.id === node.id)?.position,
      ).toEqual(firstPositions.get(node.id))
    }
    for (let leftIndex = 0; leftIndex < secondLayout.length; leftIndex += 1) {
      const left = secondLayout[leftIndex]!
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < secondLayout.length;
        rightIndex += 1
      ) {
        const right = secondLayout[rightIndex]!
        const intersects =
          left.position.x < right.position.x + (right.width ?? 172) &&
          left.position.x + (left.width ?? 172) > right.position.x &&
          left.position.y < right.position.y + (right.height ?? 52) &&
          left.position.y + (left.height ?? 52) > right.position.y
        expect(intersects).toBe(false)
      }
    }
  })
})
