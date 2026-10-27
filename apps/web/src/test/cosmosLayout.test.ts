import { describe, expect, it } from 'vitest'
import {
  ancestryPath,
  computeCosmosLayout,
  RING_RADIUS,
} from '../lib/cosmosLayout'

const n = (
  id: string,
  extra: Partial<Parameters<typeof computeCosmosLayout>[0][number]> = {},
) => ({
  id,
  type: 'IDEA',
  status: 'VISIBLE' as const,
  operator: null,
  distance: 'near',
  ...extra,
})
const e = (parentId: string, childId: string, minute: number) => ({
  id: `${parentId}-${childId}`,
  parentId,
  childId,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
})
const nodes = [
  n('root', { type: 'ROOT_PROMPT', distance: null }),
  n('a', { distance: 'near' }),
  n('b', { distance: 'leap' }),
  n('g', { operator: 'GROUND' }),
  n('t', { operator: 'TRANSPLANT', distance: 'adjacent' }),
  n('r', { status: 'REJECTED', distance: 'near' }),
  n('p', { status: 'PINNED', distance: 'adjacent' }),
]
const edges = [
  e('root', 'a', 1),
  e('root', 'b', 2),
  e('a', 'g', 3),
  e('a', 't', 4),
  e('root', 'r', 5),
  e('root', 'p', 6),
]
const flat = (p: [number, number, number]) => Math.hypot(p[0], p[2])

describe('cosmos layout', () => {
  const bodies = computeCosmosLayout(nodes, edges)
  const by = Object.fromEntries(bodies.map((body) => [body.id, body]))

  it('puts the prompt at the core and directions on rings by distance label', () => {
    expect(by.root!.kind).toBe('core')
    expect(by.root!.position).toEqual([0, 0, 0])
    expect(flat(by.a!.position)).toBeCloseTo(RING_RADIUS.near!, 5)
    expect(flat(by.b!.position)).toBeCloseTo(RING_RADIUS.leap!, 5)
  })

  it('is deterministic', () => {
    expect(computeCosmosLayout(nodes, edges)).toEqual(bodies)
  })

  it('orbits operator children around their parent and seeds transplants elsewhere', () => {
    const a = by.a!.position
    const distanceFromA = (id: string) => {
      const p = by[id]!.position
      return Math.hypot(p[0] - a[0], p[2] - a[2])
    }
    expect(by.g!.kind).toBe('moon')
    expect(distanceFromA('g')).toBeLessThan(1.5)
    expect(by.t!.kind).toBe('seed-system')
    expect(distanceFromA('t')).toBeGreaterThan(3)
  })

  it('maps steering states to light and drift', () => {
    expect(by.p!.emissive).toBeGreaterThan(by.a!.emissive)
    expect(by.r!.emissive).toBeLessThan(by.a!.emissive)
    expect(flat(by.r!.position)).toBeGreaterThan(RING_RADIUS.near!)
  })

  it('builds the ancestry path from prompt to focus', () => {
    expect(ancestryPath(edges, 'g')).toEqual(['root', 'a', 'g'])
    expect(ancestryPath(edges, null)).toEqual([])
  })
})
