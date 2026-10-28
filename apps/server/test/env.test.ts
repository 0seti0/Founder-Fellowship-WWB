import { describe, expect, it, vi } from 'vitest'
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
    expect(() => parseEnv({ MODEL_MODE: 'live' })).toThrow(/LLM_API_KEY/)
  })

  it('prefers LLM_API_KEY and accepts the deprecated key with one safe warning', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      parseEnv({ MODEL_MODE: 'live', LLM_API_KEY: 'new-secret' }).LLM_API_KEY,
    ).toBe('new-secret')
    const legacy = parseEnv({
      MODEL_MODE: 'live',
      MODEL_API_KEY: 'legacy-secret',
    })
    expect(legacy.MODEL_API_KEY).toBe('legacy-secret')
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0]?.[0]).toBe(
      'MODEL_API_KEY is deprecated; use LLM_API_KEY instead.',
    )
    expect(warning.mock.calls[0]?.[0]).not.toContain('legacy-secret')
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })

  it('uses the OpenAI-compatible defaults and validates temperature', () => {
    const parsed = parseEnv({})
    expect(parsed.LLM_BASE_URL).toBe('https://api.openai.com/v1')
    expect(parsed.LLM_MODEL_STRONG).toBe('gpt-4.1')
    expect(parsed.LLM_MODEL_FAST).toBe('gpt-4.1-mini')
    expect(parsed.LLM_EMBEDDING_MODEL).toBe('text-embedding-3-small')
    expect(parseEnv({ LLM_TEMPERATURE: '0.3' }).LLM_TEMPERATURE).toBe(0.3)
    expect(() => parseEnv({ LLM_TEMPERATURE: '3' })).toThrow()
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
