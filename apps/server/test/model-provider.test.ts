import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameCandidate } from '@unfold/shared'
import { compareCandidates } from '../src/generation/functionalEquivalence'
import { generatePipeline } from '../src/generation/pipeline'
import {
  EVALUATE_RUBRIC_PROMPT_VERSION,
  EXTRACT_PROMPT_VERSION,
  FRAME_AXIS_FREE_PROMPT_VERSION,
} from '../src/generation/prompts'
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

function anthropicProvider(
  overrides: Record<string, unknown> = {},
): ModelProvider {
  return createModelProvider({
    MODEL_MODE: 'live',
    LLM_PROVIDER: 'anthropic',
    LLM_API_KEY: apiKey,
    LLM_BASE_URL: 'https://provider.example/v1',
    LLM_MODEL_STRONG: 'claude-strong-test',
    LLM_MODEL_FAST: 'claude-fast-test',
    LLM_MAX_TOKENS: 2048,
    LLM_TEMPERATURE: 0.2,
    ...overrides,
  })
}

function mockAnthropicFetch(options: { textFirstExtract?: boolean } = {}) {
  const mockProvider = createModelProvider({ MODEL_MODE: 'mock' })
  let extractCalls = 0
  return vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      system: string
      tools: Array<{ name: string }>
      messages: Array<{ content: string }>
    }
    const task = body.tools[0]!.name.replace('submit_', '')
    if (task === 'extract') {
      extractCalls += 1
      if (options.textFirstExtract && extractCalls === 1) {
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'not valid structured output' }],
          }),
          { status: 200 },
        )
      }
    }
    const promptVersion =
      task === 'extract'
        ? EXTRACT_PROMPT_VERSION
        : task === 'frame'
          ? FRAME_AXIS_FREE_PROMPT_VERSION
          : task === 'evaluate'
            ? EVALUATE_RUBRIC_PROMPT_VERSION
            : 'functional-equivalence-v1'
    const input = JSON.parse(body.messages[0]!.content) as unknown
    const result = await mockProvider.generateStructured({
      task: task as StructuredGenerationRequest['task'],
      promptVersion,
      schemaVersion: 'idea-schema-v2',
      system: body.system,
      input,
      signal: init?.signal as AbortSignal,
    })
    return new Response(
      JSON.stringify({
        content: [{ type: 'tool_use', input: result }],
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
      { status: 200 },
    )
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

describe('Anthropic live provider', () => {
  it('uses the messages tool contract and keeps the key only in its header', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                name: 'submit_extract',
                input: { facts: [] },
              },
            ],
            usage: { input_tokens: 13, output_tokens: 5 },
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    let usage: Record<string, number> | undefined
    const provider = anthropicProvider()
    const result = await request(provider, {
      onUsage: (value) => {
        usage = value
      },
    })
    expect(result).toEqual({ facts: [] })
    expect(provider.identity).toEqual({
      provider: 'anthropic',
      model: 'claude-strong-test',
    })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://provider.example/v1/messages')
    expect(init?.headers).toMatchObject({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    const serializedBody = String(init?.body)
    expect(serializedBody).not.toContain(apiKey)
    expect(JSON.stringify(init?.headers)).toContain(apiKey)
    const body = JSON.parse(serializedBody) as {
      model: string
      max_tokens: number
      system: string
      messages: Array<{ role: string; content: string }>
      tools: Array<{
        name: string
        description: string
        input_schema: Record<string, unknown>
      }>
      tool_choice: { type: string; name: string }
      temperature: number
    }
    expect(body).toMatchObject({
      model: 'claude-fast-test',
      max_tokens: 2048,
      system: 'Extract evidence.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ prompt: 'A neighborhood bakery.' }),
        },
      ],
      tools: [
        {
          name: 'submit_extract',
          description: 'Return the result for this task.',
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_extract' },
      temperature: 0.2,
    })
    expect(body.tools[0]?.input_schema).not.toHaveProperty('$schema')
    expect(usage).toEqual({ input_tokens: 13, output_tokens: 5 })
  })

  it('uses provider-specific defaults when selected through createModelProvider', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ content: [{ type: 'tool_use', input: {} }] }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = createModelProvider({
      MODEL_MODE: 'live',
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: apiKey,
    })
    await request(provider)
    expect(provider.identity).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string
      max_tokens: number
    }
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 16_000,
    })
  })

  it('uses the strong model for framing, expansion, and evaluation', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ content: [{ type: 'tool_use', input: {} }] }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = anthropicProvider()
    for (const task of ['frame', 'expand', 'evaluate'] as const) {
      await request(provider, {
        task,
        promptVersion:
          task === 'frame' ? FRAME_AXIS_FREE_PROMPT_VERSION : `${task}-v1`,
      })
    }
    for (const [index, task] of ['frame', 'expand', 'evaluate'].entries()) {
      const body = JSON.parse(
        String(fetchMock.mock.calls[index]?.[1]?.body),
      ) as { model: string }
      expect(body.model, task).toBe('claude-strong-test')
    }
  })

  it('uses the fast model for extraction and comparison', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ content: [{ type: 'tool_use', input: {} }] }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = anthropicProvider()
    for (const task of ['extract', 'compare'] as const) {
      await request(provider, { task, promptVersion: `${task}-v1` })
    }
    for (const [index, task] of ['extract', 'compare'].entries()) {
      const body = JSON.parse(
        String(fetchMock.mock.calls[index]?.[1]?.body),
      ) as { model: string }
      expect(body.model, task).toBe('claude-fast-test')
    }
  })

  it('rejects max-token truncation after reporting usage', async () => {
    const partialInput = { candidates: [{ title: 'Truncated candidate' }] }
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            stop_reason: 'max_tokens',
            content: [{ type: 'tool_use', input: partialInput }],
            usage: { input_tokens: 1200, output_tokens: 2048 },
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    let usage: Record<string, number> | undefined
    const result = request(anthropicProvider(), {
      onUsage: (value) => {
        usage = value
      },
    })
    await expect(result).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message:
        'Anthropic output was truncated at max_tokens (LLM_MAX_TOKENS=2048)',
    })
    expect(usage).toEqual({ input_tokens: 1200, output_tokens: 2048 })
  })

  it('maps HTTP and Anthropic error responses to PROVIDER_ERROR', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('mock content', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'overloaded_error', message: 'try again' },
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const provider = anthropicProvider()
    await expect(request(provider)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
    await expect(request(provider)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: expect.stringContaining('overloaded_error'),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps network errors to a safe PROVIDER_ERROR', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error(`connection failed: ${apiKey}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(request(anthropicProvider())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'Anthropic provider request failed',
    })
  })

  it('maps aborted requests to TIMEOUT', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      request(anthropicProvider(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('returns concatenated text when the response has no tool use', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'text', text: 'first ' },
              { type: 'text', text: 'second' },
            ],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(request(anthropicProvider())).resolves.toBe('first second')
  })

  it('rejects responses with no content', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ content: [] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(request(anthropicProvider())).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })

  it('repairs text-only output once and falls back to degraded text deduplication', async () => {
    const fetchMock = mockAnthropicFetch({ textFirstExtract: true })
    vi.stubGlobal('fetch', fetchMock)
    const result = await generatePipeline({
      prompt: 'I want to open a bakery for nearby families.',
      provider: anthropicProvider(),
      timeoutMs: 1000,
      strategy: 'JOINT_AXIS_FREE_V1',
      explorationSeed: 'anthropic-fallback-test',
    })
    expect(
      result.attempts
        .filter((attempt) => attempt.task === 'extract')
        .map((attempt) => attempt.ok),
    ).toEqual([false, true])
    expect(
      result.attempts.find(
        (attempt) => attempt.task === 'extract' && attempt.ok,
      )?.metadata?.usage,
    ).toEqual({ input_tokens: 5, output_tokens: 7 })
    expect(result.dedupMode).toBe('TEXT_FALLBACK')
    expect(result.degraded).toBe(true)
    expect(
      result.attempts.some(
        (attempt) =>
          attempt.task === 'dedupe' && attempt.code === 'TEXT_FALLBACK',
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.filter(([, init]) => {
        const body = JSON.parse(String(init?.body)) as {
          tools: Array<{ name: string }>
        }
        return body.tools[0]?.name === 'submit_extract'
      }),
    ).toHaveLength(2)
  })

  it('throws the existing provider error code for unavailable embeddings', async () => {
    await expect(
      anthropicProvider().embed(['candidate text'], AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'Anthropic does not provide embeddings',
    })
  })
})

describe('provider error contract', () => {
  it('keeps provider failures typed', () => {
    expect(new ProviderError('failed', 'PROVIDER_ERROR').code).toBe(
      'PROVIDER_ERROR',
    )
  })
})
