import { describe, expect, it } from 'vitest'
import { parseEnv } from '../src/env'

describe('environment configuration', () => {
  it('defaults to mock mode and the local database', () => {
    const parsed = parseEnv({})
    expect(parsed.MODEL_MODE).toBe('mock')
    expect(parsed.MODEL_TIMEOUT_MS).toBe(30_000)
    expect(parsed.DATABASE_URL).toBe(
      'mysql://unfold:unfold@localhost:3306/unfold',
    )
  })

  it('accepts a positive model call timeout', () => {
    expect(parseEnv({ MODEL_TIMEOUT_MS: '2500' }).MODEL_TIMEOUT_MS).toBe(2500)
    expect(() => parseEnv({ MODEL_TIMEOUT_MS: '0' })).toThrow()
  })

  it('requires a model key in live mode', () => {
    expect(() => parseEnv({ MODEL_MODE: 'live' })).toThrow(/MODEL_API_KEY/)
  })

  it('does not include the key in health responses', async () => {
    const response = await createHealthResponse()
    expect(response).not.toHaveProperty('MODEL_API_KEY')
    expect(JSON.stringify(response)).not.toContain('test-secret')
  })
})

async function createHealthResponse() {
  const { createApp } = await import('../src/app')
  const response = await createApp().request('/health')
  return response.json()
}
