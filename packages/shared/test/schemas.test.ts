import { describe, expect, it } from 'vitest'
import {
  DbHealthSchema,
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
})
