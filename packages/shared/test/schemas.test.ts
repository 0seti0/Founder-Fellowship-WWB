import { describe, expect, it } from 'vitest'
import {
  DbHealthSchema,
  ExtractionOutputSchema,
  FrameOutputSchema,
  HealthStatusSchema,
  ModelModeSchema,
} from '../src/index'

describe('shared schemas', () => {
  it('accepts a valid health status', () => {
    expect(
      HealthStatusSchema.parse({
        status: 'ok',
        service: 'unfold-server',
        modelMode: 'mock',
        time: '2025-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ status: 'ok', modelMode: 'mock' })
  })

  it('rejects invalid health status fields and timestamps', () => {
    expect(
      HealthStatusSchema.safeParse({
        status: 'bad',
        service: 'unfold-server',
        modelMode: 'mock',
        time: 'not-a-date',
      }).success,
    ).toBe(false)
  })

  it('accepts only supported model modes', () => {
    expect(ModelModeSchema.parse('live')).toBe('live')
    expect(ModelModeSchema.safeParse('other').success).toBe(false)
  })

  it('requires a non-negative integer migration count', () => {
    expect(
      DbHealthSchema.parse({ status: 'ok', migrationsApplied: 0 }).status,
    ).toBe('ok')
    expect(
      DbHealthSchema.safeParse({ status: 'ok', migrationsApplied: -1 }).success,
    ).toBe(false)
    expect(
      DbHealthSchema.safeParse({ status: 'ok', migrationsApplied: 1.2 })
        .success,
    ).toBe(false)
  })

  it('requires explicit basis for a hard extracted constraint', () => {
    expect(
      ExtractionOutputSchema.safeParse({
        facts: [],
        constraints: [
          {
            ref: 'c1',
            text: 'Keep the budget low',
            evidence: 'keep the budget low',
            strength: 'hard',
            basis: 'inferred',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects model-local frame fields outside the strict schema', () => {
    expect(
      FrameOutputSchema.safeParse({
        candidates: [
          {
            key: 'idea-1',
            title: 'Test an idea',
            summary: 'A brief summary',
            hypothesis: {
              statement: 'The goal may be to test an idea.',
              axes: {
                goal: 'validate demand',
                beneficiary: 'the user',
                motivation: 'learn',
                mechanism: 'small test',
                timeHorizon: 'months',
                risk: 'low',
              },
              assumptions: ['The user wants to learn.'],
              supportingFactRefs: [],
              counterevidence: [],
              falsifiers: ['No one responds.'],
            },
            preservedIntent: 'Explore the idea.',
            changedAssumptions: ['Start small.'],
            fitRationale: 'It tests demand.',
            strongestObjection: 'Demand may not matter.',
            firstTest: 'Send a survey to 10 people this week.',
            mechanism: 'Ask potential users.',
            facets: ['validation'],
            distance: 'near',
            id: 'model-generated-id',
          },
        ],
      }).success,
    ).toBe(false)
  })
})
