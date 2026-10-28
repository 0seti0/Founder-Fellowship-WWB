import { describe, expect, it } from 'vitest'
import { calculateExperimentMetrics } from '../src/experiments/metrics'

describe('experiment metrics', () => {
  it('uses equivalence classes and keeps redundancy and Q metrics separate', () => {
    const metrics = calculateExperimentMetrics(
      [
        { id: 'a', qualityScore: 0.8, eligibility: 'ELIGIBLE' },
        { id: 'b', qualityScore: 0.6, eligibility: 'ELIGIBLE' },
        { id: 'c', qualityScore: 0.4, eligibility: 'ELIGIBLE' },
        { id: 'd', qualityScore: 0.2, eligibility: 'REJECTED' },
      ],
      [
        {
          leftId: 'a',
          rightId: 'b',
          verdict: 'equivalent',
          similarity: 0.8,
        },
        {
          leftId: 'b',
          rightId: 'c',
          verdict: 'equivalent',
          similarity: 0.7,
        },
        {
          leftId: 'a',
          rightId: 'c',
          verdict: 'related_but_distinct',
          similarity: 0.6,
        },
        {
          leftId: 'a',
          rightId: 'd',
          verdict: 'distinct',
          similarity: 0.1,
        },
      ],
      ['a', 'c'],
    )

    expect(metrics.distinctAtK).toBe(1)
    expect(metrics.effectiveDistinctAtK).toBe(1)
    expect(metrics.pairwiseRedundancy).toEqual({
      counts: {
        equivalent: 2,
        related_but_distinct: 1,
        distinct: 1,
      },
      proportions: {
        equivalent: 0.5,
        related_but_distinct: 0.25,
        distinct: 0.25,
      },
      comparedPairs: 4,
    })
    expect(metrics.slateEmbeddingSimilarity).toEqual({
      status: 'available',
      mean: 0.6,
      max: 0.6,
      comparedPairs: 1,
    })
    expect(metrics.meanQ.allCandidates).toBeCloseTo(0.5)
    expect(metrics.meanQ.selectedSlate).toBeCloseTo(0.6)
    expect(metrics).not.toHaveProperty('alignedNovelty')
  })

  it('returns zero counts and null means for empty experiment results', () => {
    expect(calculateExperimentMetrics([], [], [])).toMatchObject({
      distinctAtK: 0,
      effectiveDistinctAtK: 0,
      pairwiseRedundancy: {
        counts: { equivalent: 0, related_but_distinct: 0, distinct: 0 },
        proportions: { equivalent: 0, related_but_distinct: 0, distinct: 0 },
        comparedPairs: 0,
      },
      slateEmbeddingSimilarity: {
        status: 'unavailable',
        mean: null,
        max: null,
        comparedPairs: 0,
      },
      meanQ: { allCandidates: null, selectedSlate: null },
    })
  })

  it('labels missing slate embedding similarity as unavailable', () => {
    const metrics = calculateExperimentMetrics(
      [
        { id: 'a', qualityScore: 0.8, eligibility: 'ELIGIBLE' },
        { id: 'b', qualityScore: 0.6, eligibility: 'ELIGIBLE' },
      ],
      [],
      ['a', 'b'],
      [{ leftId: 'a', rightId: 'b', similarity: null }],
    )
    expect(metrics.slateEmbeddingSimilarity).toEqual({
      status: 'unavailable',
      mean: null,
      max: null,
      comparedPairs: 0,
    })
  })
})
