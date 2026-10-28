import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameCandidate } from '@unfold/shared'
import { compareCandidates } from '../src/generation/functionalEquivalence'
import { generatePipeline } from '../src/generation/pipeline'
import {
  createModelProvider,
  ProviderError,
  type ModelProvider,
  type StructuredGenerationRequest,
} from '../src/model/provider'

const apiKey = 'test-api-key-must-not-leak'

const candidate: FrameCandidate = {
  key: 'k1',
  title: 'Test a weekly bread preorder',
  summary: 'Offer a weekly bread preorder to nearby families.',
  hypothesis: {
    statement: 'Nearby families may value a regular pickup.',
    assumptions: ['Families want weekly bread.'],
    supportingFactRefs: [],
    counterevidence: [],
    falsifiers: ['Nobody signs up.'],
  },
  preservedIntent: 'Explore a neighborhood bakery.',
  changedAssumptions: ['Start with preorders.'],
  fitRationale: 'A preorder checks interest before expansion.',
  strongestObjection: 'Families may prefer daily choices.',
  firstTest: 'Ask six families to preorder a loaf by Friday.',
  mechanism: 'Weekly preorder and pickup.',
  distance: 'near',
}

function liveProvider(): ModelProvider {
  return createModelProvider({
    MODEL_MODE: 'live',
    LLM_API_KEY: apiKey,
    LLM_BASE_URL: 'https://provider.example/v1',
    LLM_MODEL_STRONG: 'strong-test',
    LLM_MODEL_FAST: 'fast-test',
    LLM_EMBEDDING_MODEL: 'embed-test',
    LLM_TEMPERATURE: 0.2,
  })
}

function request(
  provider: ModelProvider,
  overrides: Partial<StructuredGenerationRequest> = {},
) {
  return provider.generateStructured({
    task: 'extract',
    promptVersion: 'extract-v1',
    schemaVersion: 'idea-schema-v2',
    system: 'Extract evidence.',
    input: { prompt: 'A neighborhood bakery.' },
    signal: AbortSignal.timeout(1000),
    ...overrides,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OpenAI-compatible live provider', () => {
  it('uses strict task schemas and keeps the key out of body and logs', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ facts: [], constraints: [] }),
                },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let usage: Record<string, number> | undefined
    const provider = liveProvider()
    const result = await request(provider, {
      onUsage: (value) => {
        usage = value
      },
    })
    expect(result).toEqual({ facts: [], constraints: [] })
    expect(provider.identity).toMatchObject({
      provider: 'openai-compatible',
      model: 'strong-test',
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://provider.example/v1/chat/completions')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` })
    const body = JSON.parse(String(init?.body)) as {
      model: string
      response_format: { type: string; json_schema?: { strict: boolean } }
    }
    expect(body.model).toBe('fast-test')
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    })
    expect(String(init?.body)).not.toContain(apiKey)
    expect(JSON.stringify([log.mock.calls, warn.mock.calls])).not.toContain(
      apiKey,
    )
    expect(usage).toEqual({
      prompt_tokens: 8,
      completion_tokens: 3,
      total_tokens: 11,
    })
  })

  it('uses the configured embedding model and returns provider vectors', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const vectors = await liveProvider().embed(
      ['first', 'second'],
      AbortSignal.timeout(1000),
    )
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://provider.example/v1/embeddings',
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'embed-test',
      input: ['first', 'second'],
    })
  })

  it('uses JSON-object mode for schemas with unsupported optional fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await request(liveProvider(), {
      task: 'frame',
      promptVersion: 'initial-axis-free-v1',
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      response_format: { type: string }
    }
    expect(body.response_format.type).toBe('json_object')
  })

  it('maps HTTP failures to PROVIDER_ERROR without falling back', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('provider unavailable', { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(request(liveProvider())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps network failures to a safe PROVIDER_ERROR', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error(`connection failed: ${apiKey}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(request(liveProvider())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'OpenAI-compatible provider request failed',
    })
  })

  it('maps an aborted request to TIMEOUT', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      request(liveProvider(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('passes malformed model content to the comparison repair flow', async () => {
    let calls = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  calls === 1
                    ? '{malformed'
                    : JSON.stringify({
                        verdict: 'equivalent',
                        rationale: 'Both use a weekly preorder mechanism.',
                      }),
              },
            },
          ],
          usage: { total_tokens: calls * 4 },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await compareCandidates(liveProvider(), {
      originalPrompt: 'I want to open a bakery.',
      left: candidate,
      right: { ...candidate, key: 'k2' },
      constraints: [],
    })
    expect(result.verdict).toBe('equivalent')
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts.map((attempt) => attempt.ok)).toEqual([false, true])
    expect(result.attempts[0]?.metadata?.usage).toEqual({ total_tokens: 4 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not require the configured key in mock mode', async () => {
    const provider = createModelProvider({ MODEL_MODE: 'mock' })
    const result = await provider.generateStructured({
      task: 'compare',
      promptVersion: 'functional-equivalence-v1',
      schemaVersion: 'functional-equivalence-v1',
      system: '',
      input: {
        left: candidate,
        right: { ...candidate, key: 'k2' },
      },
      signal: AbortSignal.timeout(1000),
    })
    expect(result).toHaveProperty('verdict', 'equivalent')
  })

  it('stores returned token usage on the corresponding pipeline attempts', async () => {
    const mock = createModelProvider({ MODEL_MODE: 'mock' })
    const provider: ModelProvider = {
      identity: mock.identity,
      generateStructured: async (request) => {
        request.onUsage?.({ total_tokens: 7 })
        return mock.generateStructured(request)
      },
      embed: (texts, signal) => mock.embed(texts, signal),
    }
    const result = await generatePipeline({
      prompt: 'I want to open a bakery for nearby families.',
      provider,
      timeoutMs: 1000,
      strategy: 'JOINT_AXIS_FREE_V1',
      explorationSeed: 'usage-test',
    })
    expect(
      result.attempts
        .filter((attempt) =>
          ['extract', 'frame', 'evaluate'].includes(attempt.task),
        )
        .every(
          (attempt) =>
            (attempt.metadata?.usage as Record<string, unknown> | undefined)
              ?.total_tokens === 7,
        ),
    ).toBe(true)
  })
})

describe('provider error contract', () => {
  it('keeps provider failures typed', () => {
    expect(new ProviderError('failed', 'PROVIDER_ERROR').code).toBe(
      'PROVIDER_ERROR',
    )
  })
})
