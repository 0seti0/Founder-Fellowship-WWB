import { describe, expect, it } from 'vitest'
import { computeLensLayout, curvePath } from '../lib/lensLayout'

const node = (id: string, type = 'IDEA') => ({ id, type })
const edge = (parentId: string, childId: string, minute: number) => ({
  id: `${parentId}-${childId}`,
  parentId,
  childId,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
})

const nodes = [
  node('root', 'ROOT_PROMPT'),
  node('a'),
  node('b'),
  node('c'),
  node('a1'),
  node('a2'),
]
const edges = [
  edge('root', 'a', 1),
  edge('root', 'b', 2),
  edge('root', 'c', 3),
  edge('a', 'a1', 4),
  edge('a', 'a2', 5),
]
const size = { width: 900, height: 640 }

describe('focus lens layout', () => {
  it('defaults the focus to the root and fans its children below it', () => {
    const layout = computeLensLayout(nodes, edges, null, size)
    const focus = layout.items.find((item) => item.role === 'focus')!
    expect(focus.id).toBe('root')
    const children = layout.items.filter((item) => item.role === 'child')
    expect(children.map((item) => item.id).sort()).toEqual(['a', 'b', 'c'])
    for (const child of children) expect(child.y).toBeGreaterThan(focus.y)
    expect(layout.thread).toHaveLength(1)
  })

  it('places ancestors, siblings, and children around a focused idea', () => {
    const layout = computeLensLayout(nodes, edges, 'a', size)
    const roles = Object.fromEntries(
      layout.items.map((item) => [item.id, item.role]),
    )
    expect(roles).toMatchObject({
      a: 'focus',
      root: 'ancestor',
      b: 'sibling',
      c: 'sibling',
      a1: 'child',
      a2: 'child',
    })
    expect(layout.thread).toHaveLength(2)
    expect(layout.offstageCount).toBe(0)
  })

  it('keeps every card inside the container and none overlapping', () => {
    const layout = computeLensLayout(nodes, edges, 'a', size)
    const boxes = layout.items.map((item) => ({
      left: item.x - (item.width * item.scale) / 2,
      right: item.x + (item.width * item.scale) / 2,
      top: item.y - (item.height * item.scale) / 2,
      bottom: item.y + (item.height * item.scale) / 2,
    }))
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(size.width)
      expect(box.bottom).toBeLessThanOrEqual(size.height)
    }
    for (let i = 0; i < boxes.length; i += 1)
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!
        const b = boxes[j]!
        const overlap =
          a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom
        expect(overlap).toBe(false)
      }
  })

  it('shows the newest children first and counts the rest as offstage', () => {
    const many = Array.from({ length: 9 }, (_, index) => node(`k${index}`))
    const manyEdges = many.map((item, index) => edge('a', item.id, 10 + index))
    const layout = computeLensLayout(
      [...nodes, ...many],
      [...edges, ...manyEdges],
      'a',
      size,
    )
    const shown = layout.items
      .filter((item) => item.role === 'child')
      .map((item) => item.id)
    expect(shown).toHaveLength(6)
    expect(shown).toContain('k8')
    expect(shown).not.toContain('a1')
    expect(layout.offstageCount).toBeGreaterThan(0)
  })

  it('draws a smooth path through the thread points', () => {
    expect(
      curvePath([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toBe('M 0.0 0.0 C 0.0 10.0 10.0 10.0 10.0 20.0')
  })
})
