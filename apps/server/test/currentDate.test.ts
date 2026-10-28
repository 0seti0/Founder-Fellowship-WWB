import { describe, expect, it, vi } from 'vitest'
import { currentDateContext } from '../src/generation/currentDate'

vi.mock('../src/env', () => ({
  env: { APP_TIMEZONE: 'America/Los_Angeles' },
}))

describe('current date context', () => {
  it('formats the date and weekday in the configured timezone', () => {
    expect(currentDateContext(new Date('2025-01-01T01:30:00.000Z'))).toEqual({
      today: '2024-12-31',
      weekday: 'Tuesday',
      timezone: 'America/Los_Angeles',
    })
  })
})
