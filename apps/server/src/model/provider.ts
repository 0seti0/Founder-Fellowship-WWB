import type {
  Axes,
  EvaluateOutputV2,
  ExtractedConstraint,
  ExtractedFact,
  ExtractionOutput,
  IdeaContent,
  FrameCandidate,
  MockScenario,
  UnaryOperator,
} from '@unfold/shared'
import {
  EvaluateOutputV2Schema,
  ExpandOutputSchema,
  ExtractionOutputSchema,
  FrameOutputSchema,
  FrameSingleOutputSchema,
  FunctionalEquivalenceOutputSchema,
  SsotOutputSchema,
} from '@unfold/shared'
import type { ModelMode } from '@unfold/shared'
import { z } from 'zod'
import { env as runtimeEnv } from '../env'
import {
  FRAME_PROMPT_VERSION,
  FRAME_SINGLE_PROMPT_VERSION,
  FRAME_PARAPHRASE_PROMPT_VERSION,
  FRAME_RANDOM_STRING_PROMPT_VERSION,
  SSOT_PROMPT_VERSION,
} from '../generation/prompts'
import { parsePartialJson } from './partialJson'

export type GenerationTask =
  'extract' | 'frame' | 'evaluate' | 'expand' | 'compare'

export type StructuredGenerationRequest = {
  task: GenerationTask
  promptVersion: string
  schemaVersion: string
  system: string
  input: unknown
  signal: AbortSignal
  onUsage?: (usage: Record<string, number>) => void
  onPartial?: (partial: unknown) => void
}

export type ModelProvider = {
  identity: { provider: string; model: string }
  generateStructured(request: StructuredGenerationRequest): Promise<unknown>
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>
}

type ExpansionFixture = {
  title: string
  goal: string
  facet: string
  motivation: string
  method: string
  firstTest: string
  beneficiary?: string
  context?: string
}

const expansionFixtures: Record<UnaryOperator, ExpansionFixture[]> = {
  GROUND: [
    {
      title: 'one-table tasting',
      goal: 'learn which loaf sells',
      facet: 'sampling',
      motivation: 'quick feedback',
      method: 'six-piece sample tray',
      firstTest:
        'Serve six sample portions at one neighborhood table and record purchases.',
    },
    {
      title: 'single-morning pickup',
      goal: 'test convenient collection',
      facet: 'pickup',
      motivation: 'less travel',
      method: 'one-hour collection window',
      firstTest:
        'Offer a one-hour pickup window Saturday and count completed orders.',
    },
    {
      title: 'three-item menu',
      goal: 'find a dependable favorite',
      facet: 'small menu',
      motivation: 'simple choices',
      method: 'three-recipe pilot menu',
      firstTest:
        'Bake three recipes and ask eight nearby families to rank them.',
    },
    {
      title: 'refundable preorder',
      goal: 'measure real willingness',
      facet: 'preorder',
      motivation: 'lower commitment',
      method: 'refundable deposit test',
      firstTest:
        'Post a refundable preorder link and count deposits before Friday.',
    },
    {
      title: 'weekend bake',
      goal: 'check repeat demand',
      facet: 'weekend pilot',
      motivation: 'reliable routine',
      method: 'one-weekend baking slot',
      firstTest:
        'Bake one weekend batch and record how many of five customers reorder.',
    },
    {
      title: 'short delivery loop',
      goal: 'verify nearby access',
      facet: 'local route',
      motivation: 'easy access',
      method: 'four-stop delivery loop',
      firstTest: 'Deliver four sample boxes nearby and record the travel time.',
    },
  ],
  REFRAME: [
    {
      title: 'caregiver breakfast club',
      goal: 'reduce morning pressure',
      facet: 'caregivers',
      motivation: 'time saved',
      method: 'weekly breakfast subscription',
      firstTest: 'Ask six caregivers to trial a weekly breakfast subscription.',
      beneficiary: 'caregivers',
    },
    {
      title: 'school pickup pantry',
      goal: 'make snacks easier to reach',
      facet: 'school access',
      motivation: 'family convenience',
      method: 'school-gate snack locker',
      firstTest:
        'Place a sample snack locker by a school and count family visits.',
      beneficiary: 'school families',
    },
    {
      title: 'workplace shared table',
      goal: 'build team connection',
      facet: 'workplace',
      motivation: 'shared breaks',
      method: 'office bread-tasting ritual',
      firstTest: 'Host a workplace tasting and ask ten staff to book another.',
      beneficiary: 'shift workers',
    },
    {
      title: 'community pantry partner',
      goal: 'reduce food waste',
      facet: 'food access',
      motivation: 'shared surplus',
      method: 'surplus-bread exchange',
      firstTest:
        'Arrange a surplus-bread exchange with one pantry and track exchanges.',
      beneficiary: 'pantry volunteers',
    },
    {
      title: 'celebration order desk',
      goal: 'make gatherings welcoming',
      facet: 'events',
      motivation: 'easy hosting',
      method: 'custom event bundle',
      firstTest:
        'Offer three event bundles to five neighborhood hosts and track replies.',
      beneficiary: 'neighborhood hosts',
    },
    {
      title: 'welcome gift boxes',
      goal: 'help newcomers feel included',
      facet: 'newcomers',
      motivation: 'belonging',
      method: 'new-resident welcome box',
      firstTest:
        'Give four welcome boxes to new residents and track their feedback.',
      beneficiary: 'new residents',
    },
  ],
  LEAP: [
    {
      title: 'bread-backed skill exchange',
      goal: 'spark mutual support',
      facet: 'barter network',
      motivation: 'shared skills',
      method: 'bread-for-skills exchange',
      firstTest:
        'Trade sample loaves for six useful skills and count the exchanges.',
    },
    {
      title: 'recipe commons',
      goal: 'spread practical knowledge',
      facet: 'open recipes',
      motivation: 'shared learning',
      method: 'community recipe license',
      firstTest:
        'Publish one open recipe and count adaptations from five groups.',
    },
    {
      title: 'library-funded baking club',
      goal: 'fund informal learning',
      facet: 'library learning',
      motivation: 'curiosity',
      method: 'microgrant from bread sales',
      firstTest:
        'Donate proceeds from one bake and record the library circle attendance.',
    },
    {
      title: 'neighborhood time bank',
      goal: 'connect people who can help',
      facet: 'time banking',
      motivation: 'reciprocity',
      method: 'loaf-credit time bank',
      firstTest:
        'Exchange six loaf credits for help and track completed exchanges.',
    },
    {
      title: 'pop-up kitchen classroom',
      goal: 'teach useful routines',
      facet: 'mobile learning',
      motivation: 'confidence',
      method: 'traveling kitchen lesson',
      firstTest:
        'Teach one traveling kitchen lesson and ask eight learners to return.',
    },
    {
      title: 'local maker incubator',
      goal: 'help small makers launch',
      facet: 'maker network',
      motivation: 'entrepreneurship',
      method: 'shared micro-batch incubator',
      firstTest:
        'Host a shared micro-batch day and count the three makers who join.',
    },
  ],
  INVERT: [
    {
      title: 'assumption stress-test',
      goal: 'test the opposite outcome',
      facet: 'counterexample',
      motivation: 'challenge certainty',
      method: 'contrary-case tasting',
      firstTest:
        'Ask six skeptics to test whether the stated assumption fails.',
    },
    {
      title: 'no-preorder walk-up',
      goal: 'explore spontaneous demand',
      facet: 'walk-up sales',
      motivation: 'low-friction access',
      method: 'unannounced sample stand',
      firstTest:
        'Set up an unannounced sample stand and count walk-up purchases.',
    },
    {
      title: 'independent pickup point',
      goal: 'test self-directed collection',
      facet: 'self-service',
      motivation: 'customer autonomy',
      method: 'honor-box pickup shelf',
      firstTest:
        'Place an honor-box shelf outside and record six collection choices.',
    },
    {
      title: 'single-flavor challenge',
      goal: 'check whether variety matters',
      facet: 'simplicity',
      motivation: 'fewer choices',
      method: 'one-flavor bake sale',
      firstTest:
        'Sell one flavor for an hour and compare requests with leftovers.',
    },
    {
      title: 'customer-led schedule',
      goal: 'see if fixed hours are needed',
      facet: 'flexible timing',
      motivation: 'customer control',
      method: 'customer-chosen pickup poll',
      firstTest:
        'Poll eight customers and schedule pickup at their least expected time.',
    },
    {
      title: 'outside-bakery trial',
      goal: 'learn whether a bakery is essential',
      facet: 'alternative venue',
      motivation: 'test assumptions',
      method: 'borrowed-kitchen pop-up',
      firstTest:
        'Run a borrowed-kitchen pop-up and ask ten visitors what mattered.',
    },
  ],
  TRANSPLANT: [
    {
      title: 'library preorder shelf',
      goal: 'make collection convenient',
      facet: 'library access',
      motivation: 'easy pickup',
      method: 'book-style reserved pickup shelf',
      firstTest:
        'Test a reserved pickup shelf with six library visitors and count collections.',
      context: 'rural libraries',
    },
    {
      title: 'school-club batch kit',
      goal: 'support group learning',
      facet: 'school clubs',
      motivation: 'hands-on learning',
      method: 'club-sized baking kit',
      firstTest: 'Give one club a baking kit and record how many complete it.',
      context: 'school clubs',
    },
    {
      title: 'clinic waiting-room menu',
      goal: 'offer a useful pause',
      facet: 'clinic access',
      motivation: 'comfort',
      method: 'appointment-timed snack delivery',
      firstTest:
        'Offer appointment-timed snacks in one clinic waiting room and count orders.',
      context: 'clinic waiting rooms',
    },
    {
      title: 'transit-hub collection',
      goal: 'fit orders into commutes',
      facet: 'commuter access',
      motivation: 'time saved',
      method: 'commuter pickup locker',
      firstTest:
        'Place six prepaid samples in a commuter locker and count collections.',
      context: 'transit hubs',
    },
    {
      title: 'farm-stand reservation',
      goal: 'coordinate local supply',
      facet: 'farm stands',
      motivation: 'less waste',
      method: 'reserved weekly produce bundle',
      firstTest:
        'Coordinate six reserved bundles through a farm stand and track collections.',
      context: 'weekend farm stands',
    },
    {
      title: 'apartment-lobby exchange',
      goal: 'build neighbor connection',
      facet: 'shared buildings',
      motivation: 'community',
      method: 'lobby-based shared order board',
      firstTest:
        'Try a shared order board in an apartment lobby and count orders for seven days.',
      context: 'apartment lobbies',
    },
  ],
}

function fixtureSummary(
  operator: UnaryOperator,
  fixture: ExpansionFixture,
  values: {
    beneficiary: string
    intent: string
    sourceMechanism: string
    assumption: string
    context: string
  },
) {
  if (operator === 'GROUND')
    return `Test ${fixture.goal} for ${values.beneficiary} with a small ${fixture.method} trial of ${values.intent}.`
  if (operator === 'REFRAME')
    return `Serve ${values.beneficiary} through ${fixture.method}, measuring ${fixture.goal} while keeping ${values.intent}.`
  if (operator === 'LEAP')
    return `Preserve ${values.intent} by using ${fixture.method} to ${fixture.goal} for ${values.beneficiary}.`
  if (operator === 'INVERT')
    return `If “${values.assumption}” proves false, ${fixture.method} can ${fixture.goal} for ${values.beneficiary}.`
  return `Adapt ${values.sourceMechanism} into ${fixture.method} in ${values.context} to ${fixture.goal} for ${values.beneficiary}.`
}

function expansionTitle(subject: string, suffix: string) {
  const fullSuffix = `: ${suffix}`
  const subjectLimit = 120 - fullSuffix.length
  if (subject.length <= subjectLimit) return `${subject}${fullSuffix}`

  const truncated = subject.slice(0, subjectLimit - 1)
  const wordBoundary = truncated.lastIndexOf(' ')
  const prefix = (
    wordBoundary > 0 ? truncated.slice(0, wordBoundary) : truncated
  ).trimEnd()
  return `${prefix}…${fullSuffix}`
}

const hyphenatedNoModifiers = new Set([
  'code',
  'brainer',
  'frills',
  'nonsense',
  'fuss',
  'show',
])

function findHyphenatedBans(text: string): string[] {
  const bans = new Set<string>()
  for (const match of text.matchAll(/\bno[-‐‑](\p{L}+)/giu)) {
    const word = match[1]!.toLowerCase()
    if (!hyphenatedNoModifiers.has(word)) bans.add(word)
  }
  return [...bans]
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'PROVIDER_ERROR' | 'TIMEOUT',
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

function describeTransportError(
  error: unknown,
  secrets: readonly (string | undefined)[],
): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const transportError = error as Record<string, unknown>
  const cause =
    transportError.cause && typeof transportError.cause === 'object'
      ? (transportError.cause as Record<string, unknown>)
      : undefined
  const causeCode =
    typeof cause?.code === 'string' || typeof cause?.code === 'number'
      ? String(cause.code)
      : undefined
  const parts = [
    transportError.name,
    transportError.message,
    causeCode,
    cause?.message,
  ].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  )
  if (parts.length === 0) return undefined

  let detail = parts.join(': ')
  const sensitiveValues = secrets
    .filter(
      (secret): secret is string =>
        typeof secret === 'string' && secret.length > 0,
    )
    .sort((a, b) => b.length - a.length)
  for (const secret of sensitiveValues) {
    detail = detail.split(secret).join('[REDACTED]')
  }
  detail = detail
    .replace(/\bhttps?:\/\/[^\s"'<>]+/giu, '[provider URL]')
    .replace(/\?[^\s"'<>]*/gu, '?[REDACTED]')
    .replace(
      /\b(x-api-key|authorization|api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/giu,
      '$1=[REDACTED]',
    )
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 200)
  return detail || undefined
}

function taskSchema(request: StructuredGenerationRequest) {
  return request.task === 'extract'
    ? ExtractionOutputSchema
    : request.task === 'frame'
      ? request.promptVersion === SSOT_PROMPT_VERSION
        ? SsotOutputSchema
        : request.promptVersion === FRAME_SINGLE_PROMPT_VERSION
          ? FrameSingleOutputSchema
          : FrameOutputSchema
      : request.task === 'evaluate'
        ? EvaluateOutputV2Schema
        : request.task === 'expand'
          ? ExpandOutputSchema
          : FunctionalEquivalenceOutputSchema
}

type ProviderEnvironment = Partial<typeof runtimeEnv> & {
  MODEL_MODE: ModelMode
}

export function createModelProvider(
  environment: ProviderEnvironment,
  opts: { mockScenario?: MockScenario } = {},
): ModelProvider {
  if (environment.MODEL_MODE === 'mock') {
    return new MockProvider(opts.mockScenario ?? 'default')
  }
  const configuration = liveConfiguration(environment)
  return configuration.LLM_PROVIDER === 'anthropic'
    ? new AnthropicProvider(configuration)
    : new LiveProvider(configuration)
}

type LiveConfiguration = Pick<
  typeof runtimeEnv,
  | 'LLM_PROVIDER'
  | 'LLM_API_KEY'
  | 'MODEL_API_KEY'
  | 'LLM_BASE_URL'
  | 'LLM_MODEL_STRONG'
  | 'LLM_MODEL_FAST'
  | 'LLM_EMBEDDING_MODEL'
  | 'LLM_TEMPERATURE'
  | 'LLM_MAX_TOKENS'
>

function liveConfiguration(
  environment: ProviderEnvironment,
): LiveConfiguration {
  const provider = environment.LLM_PROVIDER ?? runtimeEnv.LLM_PROVIDER
  const defaults =
    provider === 'anthropic'
      ? {
          baseUrl: 'https://api.anthropic.com/v1',
          strongModel: 'claude-sonnet-4-5',
          fastModel: 'claude-haiku-4-5',
        }
      : {
          baseUrl: 'https://api.openai.com/v1',
          strongModel: 'gpt-4.1',
          fastModel: 'gpt-4.1-mini',
        }
  const inheritsRuntimeDefaults = provider === runtimeEnv.LLM_PROVIDER
  return {
    ...runtimeEnv,
    ...environment,
    LLM_PROVIDER: provider,
    LLM_API_KEY: environment.LLM_API_KEY ?? runtimeEnv.LLM_API_KEY,
    MODEL_API_KEY: environment.MODEL_API_KEY ?? runtimeEnv.MODEL_API_KEY,
    LLM_BASE_URL:
      environment.LLM_BASE_URL ??
      (inheritsRuntimeDefaults ? runtimeEnv.LLM_BASE_URL : defaults.baseUrl),
    LLM_MODEL_STRONG:
      environment.LLM_MODEL_STRONG ??
      (inheritsRuntimeDefaults
        ? runtimeEnv.LLM_MODEL_STRONG
        : defaults.strongModel),
    LLM_MODEL_FAST:
      environment.LLM_MODEL_FAST ??
      (inheritsRuntimeDefaults
        ? runtimeEnv.LLM_MODEL_FAST
        : defaults.fastModel),
    LLM_EMBEDDING_MODEL:
      environment.LLM_EMBEDDING_MODEL ?? runtimeEnv.LLM_EMBEDDING_MODEL,
    LLM_TEMPERATURE: environment.LLM_TEMPERATURE ?? runtimeEnv.LLM_TEMPERATURE,
    LLM_MAX_TOKENS:
      environment.LLM_MAX_TOKENS ?? runtimeEnv.LLM_MAX_TOKENS ?? 16_000,
  }
}

function modelForTask(configuration: LiveConfiguration, task: GenerationTask) {
  return task === 'frame' || task === 'expand' || task === 'evaluate'
    ? configuration.LLM_MODEL_STRONG
    : configuration.LLM_MODEL_FAST
}

class LiveProvider implements ModelProvider {
  readonly identity: { provider: string; model: string }

  constructor(private readonly configuration: LiveConfiguration) {
    this.identity = {
      provider: 'openai-compatible',
      model: configuration.LLM_MODEL_STRONG,
    }
  }

  async generateStructured(request: StructuredGenerationRequest) {
    const apiKey =
      this.configuration.LLM_API_KEY ?? this.configuration.MODEL_API_KEY
    if (!apiKey) {
      throw new ProviderError(
        'LLM_API_KEY is required for live model requests',
        'PROVIDER_ERROR',
      )
    }
    const model = modelForTask(this.configuration, request.task)
    const responseFormat = this.responseFormat(request)
    const body = {
      model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: JSON.stringify(request.input) },
      ],
      ...(this.configuration.LLM_TEMPERATURE === undefined
        ? {}
        : { temperature: this.configuration.LLM_TEMPERATURE }),
      response_format: responseFormat,
    }
    const response = await this.requestJson(
      `${this.configuration.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      },
      request.signal,
    )
    const envelope = response as {
      choices?: Array<{ message?: { content?: unknown } }>
      usage?: Record<string, number>
    }
    const content = envelope.choices?.[0]?.message?.content
    if (envelope.usage) request.onUsage?.(envelope.usage)
    if (typeof content !== 'string') {
      throw new ProviderError(
        'OpenAI-compatible provider returned no message content',
        'PROVIDER_ERROR',
      )
    }
    try {
      return JSON.parse(content) as unknown
    } catch {
      return content
    }
  }

  async embed(texts: string[], signal: AbortSignal) {
    const apiKey =
      this.configuration.LLM_API_KEY ?? this.configuration.MODEL_API_KEY
    if (!apiKey) {
      throw new ProviderError(
        'LLM_API_KEY is required for live model requests',
        'PROVIDER_ERROR',
      )
    }
    if (texts.length === 0) return []
    const response = await this.requestJson(
      `${this.configuration.LLM_BASE_URL.replace(/\/+$/, '')}/embeddings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.configuration.LLM_EMBEDDING_MODEL,
          input: texts,
        }),
        signal,
      },
      signal,
    )
    const data = (response as { data?: Array<{ embedding?: unknown }> }).data
    if (
      !Array.isArray(data) ||
      data.length !== texts.length ||
      data.some(
        (item) =>
          !Array.isArray(item.embedding) ||
          item.embedding.some((value) => typeof value !== 'number'),
      )
    ) {
      throw new ProviderError(
        'OpenAI-compatible provider returned invalid embeddings',
        'PROVIDER_ERROR',
      )
    }
    return data.map((item) => item.embedding as number[])
  }

  private responseFormat(request: StructuredGenerationRequest) {
    try {
      const jsonSchema = z.toJSONSchema(taskSchema(request))
      if (!supportsStrictJsonSchema(jsonSchema)) {
        return { type: 'json_object' }
      }
      const providerSchema = {
        ...(jsonSchema as Record<string, unknown>),
      }
      delete providerSchema.$schema
      return {
        type: 'json_schema',
        json_schema: {
          name: `${request.task}_${request.schemaVersion}`.replace(
            /[^a-zA-Z0-9_-]/g,
            '_',
          ),
          strict: true,
          schema: providerSchema,
        },
      }
    } catch {
      return { type: 'json_object' }
    }
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await fetch(url, init)
      if (!response.ok) {
        throw new ProviderError(
          `OpenAI-compatible provider returned HTTP ${response.status}`,
          'PROVIDER_ERROR',
        )
      }
      return await response.json()
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (
        signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new ProviderError('Model request timed out', 'TIMEOUT')
      }
      const detail = describeTransportError(error, [
        this.configuration.LLM_API_KEY,
        this.configuration.MODEL_API_KEY,
      ])
      throw new ProviderError(
        detail
          ? `OpenAI-compatible provider request failed (${detail})`
          : 'OpenAI-compatible provider request failed',
        'PROVIDER_ERROR',
      )
    }
  }
}

type AnthropicContentBlock = {
  type?: string
  input?: unknown
  text?: unknown
}

type AnthropicStreamEvent = {
  type?: unknown
  error?: { type?: unknown }
  message?: { usage?: { input_tokens?: unknown } }
  index?: unknown
  content_block?: { type?: unknown }
  delta?: {
    type?: unknown
    partial_json?: unknown
    text?: unknown
    stop_reason?: unknown
  }
  usage?: { output_tokens?: unknown }
}

class AnthropicProvider implements ModelProvider {
  readonly identity: { provider: string; model: string }

  constructor(private readonly configuration: LiveConfiguration) {
    this.identity = {
      provider: 'anthropic',
      model: configuration.LLM_MODEL_STRONG,
    }
  }

  async generateStructured(request: StructuredGenerationRequest) {
    const apiKey =
      this.configuration.LLM_API_KEY ?? this.configuration.MODEL_API_KEY
    if (!apiKey) {
      throw new ProviderError(
        'LLM_API_KEY is required for live model requests',
        'PROVIDER_ERROR',
      )
    }
    const model = modelForTask(this.configuration, request.task)
    const toolName = `submit_${request.task}`
    const inputSchema = {
      ...(z.toJSONSchema(taskSchema(request)) as Record<string, unknown>),
    }
    delete inputSchema.$schema
    const body = {
      model,
      max_tokens: this.configuration.LLM_MAX_TOKENS,
      system: request.system,
      messages: [{ role: 'user', content: JSON.stringify(request.input) }],
      tools: [
        {
          name: toolName,
          description: 'Return the result for this task.',
          input_schema: inputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: toolName },
      ...(this.configuration.LLM_TEMPERATURE === undefined
        ? {}
        : { temperature: this.configuration.LLM_TEMPERATURE }),
      ...(request.onPartial ? { stream: true } : {}),
    }
    const url = `${this.configuration.LLM_BASE_URL.replace(/\/+$/, '')}/messages`
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        // Without this, Claude buffers a tool argument until it is complete,
        // so a single-array tool input arrives all at once at the end.
        ...(request.onPartial
          ? { 'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14' }
          : {}),
      },
      body: JSON.stringify(body),
      signal: request.signal,
    }
    if (request.onPartial) {
      return this.requestStream(url, init, request)
    }
    const envelope = (await this.requestJson(url, init, request.signal)) as {
      type?: string
      error?: { type?: string }
      stop_reason?: string
      content?: AnthropicContentBlock[]
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    if (envelope.type === 'error') {
      const errorType = envelope.error?.type
      throw new ProviderError(
        `Anthropic provider returned an error${errorType ? ` (${errorType})` : ''}`,
        'PROVIDER_ERROR',
      )
    }
    if (
      typeof envelope.usage?.input_tokens === 'number' &&
      typeof envelope.usage.output_tokens === 'number'
    ) {
      request.onUsage?.({
        input_tokens: envelope.usage.input_tokens,
        output_tokens: envelope.usage.output_tokens,
      })
    }
    if (envelope.stop_reason === 'max_tokens') {
      throw new ProviderError(
        `Anthropic output was truncated at max_tokens (LLM_MAX_TOKENS=${this.configuration.LLM_MAX_TOKENS})`,
        'PROVIDER_ERROR',
      )
    }
    if (!Array.isArray(envelope.content) || envelope.content.length === 0) {
      throw new ProviderError(
        'Anthropic provider returned no content',
        'PROVIDER_ERROR',
      )
    }
    const toolUse = envelope.content.find((block) => block.type === 'tool_use')
    if (toolUse) return toolUse.input
    return envelope.content
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .join('')
  }

  private async requestStream(
    url: string,
    init: RequestInit,
    request: StructuredGenerationRequest,
  ): Promise<unknown> {
    try {
      const response = await fetch(url, init)
      if (!response.ok) {
        throw new ProviderError(
          `Anthropic provider returned HTTP ${response.status}`,
          'PROVIDER_ERROR',
        )
      }
      if (!response.body) {
        throw new ProviderError(
          'Anthropic provider returned no content',
          'PROVIDER_ERROR',
        )
      }

      let inputTokens: number | undefined
      let outputTokens: number | undefined
      let stopReason: string | undefined
      let toolBuffer = ''
      let textBuffer = ''
      let toolSeen = false
      let messageStopped = false
      let contentBlocks = 0
      let lastPartialAt = Number.NEGATIVE_INFINITY
      const blockTypes = new Map<number, string>()
      const dataLines: string[] = []
      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      let lineBuffer = ''

      const dispatchEvent = () => {
        if (dataLines.length === 0) return
        const data = dataLines.join('\n')
        dataLines.length = 0
        if (data === '[DONE]') return
        let parsedEvent: unknown
        try {
          parsedEvent = JSON.parse(data) as unknown
        } catch {
          throw new ProviderError(
            'Anthropic provider returned an invalid stream event',
            'PROVIDER_ERROR',
          )
        }
        if (!parsedEvent || typeof parsedEvent !== 'object') {
          throw new ProviderError(
            'Anthropic provider returned an invalid stream event',
            'PROVIDER_ERROR',
          )
        }
        const event = parsedEvent as AnthropicStreamEvent
        if (event.type === 'error') {
          const errorType = event.error?.type
          throw new ProviderError(
            `Anthropic provider returned an error${typeof errorType === 'string' ? ` (${errorType})` : ''}`,
            'PROVIDER_ERROR',
          )
        }
        if (event.type === 'message_start') {
          const tokens = event.message?.usage?.input_tokens
          if (typeof tokens === 'number') inputTokens = tokens
        } else if (event.type === 'content_block_start') {
          const index =
            typeof event.index === 'number' ? event.index : blockTypes.size
          const type = event.content_block?.type
          if (typeof type === 'string') blockTypes.set(index, type)
          contentBlocks += 1
          if (type === 'tool_use') toolSeen = true
        } else if (event.type === 'content_block_delta') {
          const type = blockTypes.get(
            typeof event.index === 'number' ? event.index : 0,
          )
          if (
            type === 'tool_use' &&
            event.delta?.type === 'input_json_delta' &&
            typeof event.delta.partial_json === 'string'
          ) {
            toolBuffer += event.delta.partial_json
            const now = Date.now()
            if (now - lastPartialAt >= 250) {
              lastPartialAt = now
              try {
                request.onPartial?.(parsePartialJson(toolBuffer))
              } catch {}
            }
          } else if (
            type === 'text' &&
            event.delta?.type === 'text_delta' &&
            typeof event.delta.text === 'string'
          ) {
            textBuffer += event.delta.text
          }
        } else if (event.type === 'message_stop') {
          messageStopped = true
        } else if (event.type === 'message_delta') {
          if (typeof event.delta?.stop_reason === 'string')
            stopReason = event.delta.stop_reason
          const tokens = event.usage?.output_tokens
          if (typeof tokens === 'number') outputTokens = tokens
        }
      }

      const processLine = (line: string) => {
        if (line === '') {
          dispatchEvent()
          return
        }
        if (line.startsWith(':')) return
        const separator = line.indexOf(':')
        const field = separator < 0 ? line : line.slice(0, separator)
        if (field !== 'data') return
        let value = separator < 0 ? '' : line.slice(separator + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        dataLines.push(value)
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          lineBuffer += decoder.decode(value, { stream: true })
          let newline = lineBuffer.indexOf('\n')
          while (newline >= 0) {
            processLine(lineBuffer.slice(0, newline).replace(/\r$/u, ''))
            lineBuffer = lineBuffer.slice(newline + 1)
            newline = lineBuffer.indexOf('\n')
          }
        }
        lineBuffer += decoder.decode()
        if (lineBuffer) processLine(lineBuffer.replace(/\r$/u, ''))
        dispatchEvent()
      } finally {
        reader.releaseLock()
      }

      if (inputTokens !== undefined && outputTokens !== undefined) {
        request.onUsage?.({
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        })
      }
      if (stopReason === 'max_tokens') {
        throw new ProviderError(
          `Anthropic output was truncated at max_tokens (LLM_MAX_TOKENS=${this.configuration.LLM_MAX_TOKENS})`,
          'PROVIDER_ERROR',
        )
      }
      if (!messageStopped) {
        throw new ProviderError(
          'Anthropic stream ended before message_stop',
          'PROVIDER_ERROR',
        )
      }
      if (contentBlocks === 0) {
        throw new ProviderError(
          'Anthropic provider returned no content',
          'PROVIDER_ERROR',
        )
      }
      if (toolSeen) {
        try {
          return JSON.parse(toolBuffer) as unknown
        } catch {
          return toolBuffer
        }
      }
      return textBuffer
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (
        request.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new ProviderError('Model request timed out', 'TIMEOUT')
      }
      const detail = describeTransportError(error, [
        this.configuration.LLM_API_KEY,
        this.configuration.MODEL_API_KEY,
      ])
      throw new ProviderError(
        detail
          ? `Anthropic provider request failed (${detail})`
          : 'Anthropic provider request failed',
        'PROVIDER_ERROR',
      )
    }
  }

  async embed(): Promise<number[][]> {
    throw new ProviderError(
      'Anthropic does not provide embeddings',
      'PROVIDER_ERROR',
    )
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await fetch(url, init)
      if (!response.ok) {
        throw new ProviderError(
          `Anthropic provider returned HTTP ${response.status}`,
          'PROVIDER_ERROR',
        )
      }
      return await response.json()
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (
        signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new ProviderError('Model request timed out', 'TIMEOUT')
      }
      const detail = describeTransportError(error, [
        this.configuration.LLM_API_KEY,
        this.configuration.MODEL_API_KEY,
      ])
      throw new ProviderError(
        detail
          ? `Anthropic provider request failed (${detail})`
          : 'Anthropic provider request failed',
        'PROVIDER_ERROR',
      )
    }
  }
}

function supportsStrictJsonSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(supportsStrictJsonSchema)
  if (!schema || typeof schema !== 'object') return true
  const record = schema as Record<string, unknown>
  if (record.type === 'object' && record.properties) {
    const properties = record.properties as Record<string, unknown>
    const required = Array.isArray(record.required) ? record.required : []
    if (Object.keys(properties).some((key) => !required.includes(key))) {
      return false
    }
  }
  return Object.values(record).every(supportsStrictJsonSchema)
}

class MockProvider implements ModelProvider {
  identity = { provider: 'mock', model: 'mock-unfold-v1' }
  private readonly calls = new Map<GenerationTask, number>()
  private malformedOnceUsed = false

  constructor(private readonly scenario: MockScenario) {}

  async generateStructured(
    request: StructuredGenerationRequest,
  ): Promise<unknown> {
    const attempt = (this.calls.get(request.task) ?? 0) + 1
    this.calls.set(request.task, attempt)
    throwIfAborted(request.signal)

    if (this.scenario === 'provider-error') {
      throw new ProviderError('Mock provider failure', 'PROVIDER_ERROR')
    }
    if (this.scenario === 'timeout') {
      return waitForAbort(request.signal)
    }
    if (this.scenario === 'malformed' || this.scenario === 'malformed-once') {
      if (request.task === 'extract' && this.shouldBeInvalid(attempt)) {
        return { facts: 'invalid', constraints: [] }
      }
      if (request.task === 'frame' && this.shouldBeInvalid(attempt)) {
        return { candidates: [{ key: 'malformed' }] }
      }
      if (request.task === 'evaluate' && this.shouldBeInvalid(attempt)) {
        return { evaluations: 'invalid' }
      }
      if (request.task === 'expand' && this.shouldBeInvalid(attempt)) {
        return { operator: 'GROUND', candidates: [] }
      }
    }

    let result: unknown
    switch (request.task) {
      case 'extract':
        result = this.extract(request.input, attempt)
        break
      case 'frame':
        result = this.frame(request)
        break
      case 'evaluate':
        result = this.evaluate(request.input)
        break
      case 'expand':
        result = this.expand(request.input)
        break
      case 'compare':
        result = this.compare(request.input)
        break
    }
    if (request.onPartial)
      this.emitPartials(request.task, result, request.onPartial)
    return result
  }

  private emitPartials(
    task: GenerationTask,
    output: unknown,
    onPartial: (partial: unknown) => void,
  ) {
    if (!output || typeof output !== 'object') return
    const property =
      task === 'frame' || task === 'expand'
        ? 'candidates'
        : task === 'evaluate'
          ? 'evaluations'
          : null
    if (!property) return
    const values = (output as Record<string, unknown>)[property]
    if (!Array.isArray(values)) return
    const emit = (partial: unknown) => {
      try {
        onPartial(partial)
      } catch {}
    }
    for (let count = 1; count <= values.length; count += 1) {
      emit({ [property]: values.slice(0, count) })
    }
    if (values.length === 0) return
    const last = values[values.length - 1]
    if (!last || typeof last !== 'object') return
    const partialLast =
      task === 'frame' || task === 'expand'
        ? {
            key: (last as Record<string, unknown>).key,
            title: (last as Record<string, unknown>).title,
          }
        : { candidateKey: (last as Record<string, unknown>).candidateKey }
    emit({
      [property]: [...values.slice(0, -1), partialLast],
    })
  }

  async embed(texts: string[], signal: AbortSignal): Promise<number[][]> {
    throwIfAborted(signal)
    if (this.scenario === 'embedding-failure') {
      throw new ProviderError('Mock embedding failure', 'PROVIDER_ERROR')
    }
    return texts.map(embedText)
  }

  private shouldBeInvalid(attempt: number) {
    if (this.scenario === 'malformed') return true
    if (
      this.scenario === 'malformed-once' &&
      attempt === 1 &&
      !this.malformedOnceUsed
    ) {
      this.malformedOnceUsed = true
      return true
    }
    return false
  }

  private extract(input: unknown, attempt: number): ExtractionOutput {
    const { prompt } = input as { prompt: string }
    const facts: ExtractedFact[] = []
    const constraints: ExtractedConstraint[] = []
    const explicitMarker =
      /\b(?:must(?:\s+not|n['’]t)?|need to|have to|cannot|can['’]t|do(?:\s+not|n['’]t)\s+want(?:\s+to)?|no more than|no(?![-‐‑])|under|only|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))?),?|within|without|never)\b/i
    const softMarker = /\b(?:ideally|prefer|would like|i'd like|hopefully)\b/i

    for (const rawClause of prompt.matchAll(/[^.!?;\n]+[.!?;]?/g)) {
      const clause = rawClause[0].trim()
      if (!clause) continue
      if (
        explicitMarker.test(clause) ||
        findHyphenatedBans(clause).length > 0
      ) {
        constraints.push({
          ref: `c${constraints.length + 1}`,
          text: clause,
          evidence: clause,
          strength: 'hard',
          basis: 'explicit',
        })
      } else if (softMarker.test(clause)) {
        constraints.push({
          ref: `c${constraints.length + 1}`,
          text: clause,
          evidence: clause,
          strength: 'soft',
          basis: 'explicit',
        })
      } else {
        facts.push({
          ref: `f${facts.length + 1}`,
          text: clause,
          evidence: clause,
        })
      }
    }

    if (
      (this.scenario === 'invalid-evidence' ||
        this.scenario === 'invalid-evidence-once') &&
      (this.scenario === 'invalid-evidence' || attempt === 1)
    ) {
      if (facts[0]) facts[0].evidence = 'not contained in the original prompt'
      else if (constraints[0])
        constraints[0].evidence = 'not contained in the original prompt'
      else
        facts.push({
          ref: 'f1',
          text: 'Invented evidence',
          evidence: 'not contained in the original prompt',
        })
    }
    return { facts, constraints }
  }

  private frame(request: StructuredGenerationRequest): unknown {
    const { originalPrompt, prompt, facts } = request.input as {
      originalPrompt?: string
      prompt?: string
      facts: ExtractedFact[]
      constraints: ExtractedConstraint[]
    }
    const sourcePrompt = originalPrompt ?? prompt ?? ''
    const subject = getSubject(
      sourcePrompt.replace(/\bno[-‐‑](\p{L}+)/giu, (modifier, word: string) =>
        hyphenatedNoModifiers.has(word.toLowerCase()) ? modifier : '',
      ),
    )
    const firstFactRef = facts[0]?.ref
    const offset = stableHash(sourcePrompt) % archetypes.length
    const selected = Array.from({ length: 6 }, (_, index) => {
      const archetype = archetypes[(offset + index) % archetypes.length]!
      const candidate = makeCandidate(archetype, subject, firstFactRef)
      if (
        request.promptVersion !== FRAME_PROMPT_VERSION &&
        request.promptVersion !== FRAME_SINGLE_PROMPT_VERSION
      ) {
        delete candidate.facets
        delete candidate.hypothesis.axes
      }
      return candidate
    })

    if (this.scenario === 'paraphrase') {
      selected.forEach((candidate, index) => {
        candidate.hypothesis.axes = {
          ...candidate.hypothesis.axes,
          goal: `slightly different goal ${index + 1}`,
          beneficiary: 'the user',
          motivation: 'explore the prompt',
          mechanism: 'consider the idea',
          timeHorizon: 'months',
          risk: 'medium',
        }
      })
    }
    if (this.scenario === 'duplicates') {
      selected[1] = {
        ...selected[0]!,
        key: selected[1]!.key,
        hypothesis: selected[1]!.hypothesis,
      }
    }
    if (this.scenario === 'operator-gaps' && selected[0]) {
      selected[0]!.changedAssumptions = ['TBD']
      selected[0]!.hypothesis.assumptions = ['TBD']
      selected[0]!.mechanism = 'unclear'
    }
    if (this.scenario === 'low-quality' && selected[0]) {
      selected[0].firstTest = 'Conduct some more research.'
    }
    const callIndex = (this.calls.get('frame') ?? 1) - 1
    const candidate = selected[callIndex % selected.length]!
    if (request.promptVersion === SSOT_PROMPT_VERSION)
      return { seed: `mockseed${callIndex}`, candidate }
    if (
      request.promptVersion === FRAME_SINGLE_PROMPT_VERSION ||
      request.promptVersion === FRAME_PARAPHRASE_PROMPT_VERSION ||
      request.promptVersion === FRAME_RANDOM_STRING_PROMPT_VERSION ||
      request.promptVersion === SSOT_PROMPT_VERSION
    )
      return { candidate }
    return { candidates: selected }
  }

  private expand(input: unknown) {
    const { operator, parent, assumption, mechanism } = input as {
      operator: UnaryOperator
      parent: IdeaContent
      assumption?: string
      mechanism?: string
    }
    const subject =
      parent.title.trim().split(': ', 1)[0]?.trim() || 'this direction'
    const sourceMechanism = (mechanism || parent.mechanism).trim()
    const beneficiary = parent.hypothesis.axes?.beneficiary ?? 'neighbors'
    const preservedIntent = parent.preservedIntent
    const trustedAssumption =
      assumption ?? parent.changedAssumptions[0] ?? 'the original assumption'
    const templates = expansionFixtures[operator]
    const candidates: IdeaContent[] = templates.map((template, index) => {
      const nextMechanism =
        operator === 'GROUND'
          ? `${template.method}, a small pilot using ${sourceMechanism}`
          : operator === 'TRANSPLANT'
            ? `${sourceMechanism} adapted as ${template.method}`
            : template.method
      const nextBeneficiary = template.beneficiary ?? beneficiary
      const context = template.context ?? 'the neighborhood'
      const summary = fixtureSummary(operator, template, {
        beneficiary: nextBeneficiary,
        intent: preservedIntent,
        sourceMechanism,
        assumption: trustedAssumption,
        context,
      }).slice(0, 600)
      const next: IdeaContent = {
        ...parent,
        key: `expand-${operator.toLowerCase()}-${index + 1}`,
        title: expansionTitle(subject, template.title),
        summary,
        hypothesis: {
          ...parent.hypothesis,
          statement: summary,
          axes: {
            ...parent.hypothesis.axes,
            goal: template.goal,
            beneficiary: nextBeneficiary,
            motivation: template.motivation,
            mechanism: nextMechanism,
            timeHorizon:
              operator === 'GROUND'
                ? 'immediate'
                : index % 2
                  ? 'months'
                  : 'years',
            risk: index % 2 ? 'medium' : 'low',
          },
          assumptions: [trustedAssumption],
          supportingFactRefs: parent.hypothesis.supportingFactRefs,
          counterevidence: [],
          falsifiers: [
            `The ${template.goal} trial fails for ${nextBeneficiary}.`,
          ],
        },
        changedAssumptions: [trustedAssumption],
        fitRationale: `This tests ${preservedIntent} through ${nextMechanism} for ${nextBeneficiary}.`,
        strongestObjection: `${nextBeneficiary} may not value ${template.goal}.`,
        firstTest: template.firstTest,
        mechanism: nextMechanism,
        facets: [template.goal, template.facet],
        distance:
          operator === 'GROUND'
            ? 'near'
            : operator === 'REFRAME'
              ? index % 2
                ? 'adjacent'
                : 'near'
              : operator === 'LEAP'
                ? 'leap'
                : parent.distance,
      }
      if (operator === 'INVERT') next.invertedAssumption = trustedAssumption
      if (operator === 'TRANSPLANT') next.targetContext = context
      return next
    })
    return {
      operator:
        this.scenario === 'operator-mismatch'
          ? operator === 'GROUND'
            ? 'LEAP'
            : 'GROUND'
          : operator,
      candidates,
    }
  }

  private evaluate(input: unknown): EvaluateOutputV2 {
    const payload = input as {
      candidates: Array<{ key: string; content: FrameCandidate }>
      constraints: ExtractedConstraint[]
    }
    const candidates = payload.candidates.map((item) => item.content)
    const { constraints } = payload
    const evaluations = candidates.map((candidate, index) => {
      const score =
        this.scenario === 'none-pass' ||
        (this.scenario === 'few-pass' && index < candidates.length - 2) ||
        (this.scenario === 'low-quality' && index === 0) ||
        (this.scenario === 'weak-diverse' && index === 5)
          ? 0
          : index % 4 === 3
            ? 1
            : 2
      return {
        candidateKey: candidate.key,
        constraints: constraints.map((constraint) => {
          let status: 'satisfied' | 'violated' | 'unknown' =
            constraint.strength === 'hard'
              ? evaluateHardConstraint(candidate, constraint)
              : 'satisfied'
          if (this.scenario === 'hard-violation') {
            if (index === 0 && constraint.strength === 'hard')
              status = 'violated'
            else if (index === 1 && constraint.strength === 'hard')
              status = 'unknown'
          } else if (constraint.strength === 'soft') {
            status = 'unknown'
          }
          return {
            constraintRef: constraint.ref,
            status,
            rationale:
              status === 'unknown'
                ? 'The direction does not provide enough detail to verify this.'
                : status === 'violated'
                  ? 'The proposed direction conflicts with this requirement.'
                  : 'The direction is consistent with this constraint.',
          }
        }),
        intentCompatibility: {
          score,
          rationale: 'The candidate fits a plausible reading of the prompt.',
        },
        decisionUsefulness: {
          score,
          rationale: 'The candidate offers a concrete decision or action.',
        },
        specificityCoherence: {
          score,
          rationale: 'The mechanism and direction are coherent.',
        },
        firstTestExecutability: {
          score,
          rationale: 'The first test is practical and observable.',
        },
        nonObviousness: {
          score: Math.max(score, 1),
          rationale: 'The direction is more than a restatement.',
        },
      }
    })
    return { evaluations }
  }

  private compare(input: unknown) {
    const { left, right } = input as {
      left: Pick<FrameCandidate, 'title' | 'summary' | 'mechanism'>
      right: Pick<FrameCandidate, 'title' | 'summary' | 'mechanism'>
    }
    const vector = (candidate: typeof left) =>
      embedText(
        `${candidate.title} ${candidate.summary} ${candidate.mechanism}`,
      )
    const leftVector = vector(left)
    const rightVector = vector(right)
    let dot = 0
    let leftMagnitude = 0
    let rightMagnitude = 0
    for (let index = 0; index < leftVector.length; index += 1) {
      dot += leftVector[index]! * rightVector[index]!
      leftMagnitude += leftVector[index]! ** 2
      rightMagnitude += rightVector[index]! ** 2
    }
    const similarity =
      leftMagnitude && rightMagnitude
        ? dot / Math.sqrt(leftMagnitude * rightMagnitude)
        : 0
    const verdict =
      similarity >= 0.85
        ? 'equivalent'
        : similarity >= 0.5
          ? 'related_but_distinct'
          : 'distinct'
    return {
      verdict,
      rationale: `“${left.title}” and “${right.title}” ${
        verdict === 'equivalent'
          ? 'pursue the same strategic option.'
          : verdict === 'related_but_distinct'
            ? 'share some ground but lead to different actions.'
            : 'pursue different strategic options.'
      }`,
    }
  }
}

const constraintStopWords = new Set([
  'a',
  'an',
  'and',
  'anybody',
  'anyone',
  'anything',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'me',
  'my',
  'nor',
  'of',
  'on',
  'or',
  'our',
  'someone',
  'something',
  'the',
  'their',
  'them',
  'there',
  'this',
  'to',
  'us',
  'we',
  'with',
  'you',
  'your',
])

const constraintSynonyms: Record<string, string[]> = {
  contact: [
    'contact',
    'interview',
    'ask',
    'invite',
    'survey',
    'call',
    'email',
    'message',
    'talk',
    'meet',
    'reach out',
  ],
  money: ['spend', 'buy', 'pay', 'cost', 'budget', 'purchase'],
  spend: ['spend', 'buy', 'pay', 'cost', 'budget', 'purchase'],
}

export function evaluateHardConstraint(
  candidate: FrameCandidate,
  constraint: ExtractedConstraint,
): 'violated' | 'unknown' {
  const terms = new Set(findHyphenatedBans(constraint.evidence))
  const ordinaryNegationMarker = String.raw`(?:must\s+not|mustn['’]t|cannot|can['’]t|do\s+not\s+want\s+to|don['’]t\s+want\s+to|no(?![-‐‑])|without|never)`
  const ordinaryNegation = new RegExp(
    String.raw`\b${ordinaryNegationMarker}\b\s+(.+?)(?=;|$|\s+but\b|,\s+(?=(?:i|we|you|they|he|she|it|but|can|may|will|should|could|might|is|are)\b)|,?\s+(?:and|or)\s+(?=\b${ordinaryNegationMarker}\b|\bno[-‐‑]\p{L}))`,
    'giu',
  )

  for (const match of constraint.evidence.matchAll(ordinaryNegation)) {
    const capture = match[1]!
    const hyphenatedWords = new Set(
      [...capture.matchAll(/\bno[-‐‑](\p{L}+)/giu)].flatMap(
        (ban) => ban[0].toLowerCase().match(/[a-z]+/g) ?? [],
      ),
    )
    const ordinaryTerms = (capture.toLowerCase().match(/[a-z]+/g) ?? [])
      .filter(
        (word) => !constraintStopWords.has(word) && !hyphenatedWords.has(word),
      )
      .slice(0, 4)
    for (const term of ordinaryTerms) terms.add(term)
  }

  if (terms.size === 0) return 'unknown'

  return candidateMatchesConstraintTerms(candidate, [...terms])
}

function candidateMatchesConstraintTerms(
  candidate: FrameCandidate,
  terms: string[],
): 'violated' | 'unknown' {
  const candidateText = [
    candidate.title,
    candidate.summary,
    candidate.mechanism,
    candidate.firstTest,
  ].join(' ')
  const candidateWords = stemWords(
    candidateText.replace(/\b(?:no|not|without|never)[-‐‑\s]+\p{L}+/giu, ' '),
  )
  for (const term of terms) {
    const normalizedTerm = stemWord(term)
    const expansions = constraintSynonyms[normalizedTerm] ?? [normalizedTerm]
    if (
      expansions.some((expansion) =>
        includesWordSequence(candidateWords, stemWords(expansion)),
      )
    ) {
      return 'violated'
    }
  }
  return 'unknown'
}

function stemWords(value: string) {
  return (value.toLowerCase().match(/[a-z]+/g) ?? []).map(stemWord)
}

function stemWord(word: string) {
  return word.replace(/(?:ing|ed|s)$/i, '')
}

function includesWordSequence(words: string[], sequence: string[]) {
  if (!sequence.length) return false
  return words.some((_, index) =>
    sequence.every((word, offset) => words[index + offset] === word),
  )
}

type Archetype = {
  key: string
  title: (subject: string) => string
  goalNounPhrase: string
  goalVerbPhrase: string
  beneficiary: string
  motivation: string
  mechanism: string
  timeHorizon: Axes['timeHorizon']
  risk: Axes['risk']
  facet: string
  summary: (subject: string) => string
  hypothesis: (subject: string) => string
  assumption: (subject: string) => string
  preservedIntent: (subject: string) => string
  changedAssumption: (subject: string) => string
  fitRationale: (subject: string) => string
  strongestObjection: (subject: string) => string
  firstTest: (subject: string) => string
  falsifier: (subject: string) => string
}

const archetypes: Archetype[] = [
  {
    key: 'validate-demand',
    title: (subject) => `Validate local demand for ${subject}`,
    goalNounPhrase: 'evidence that local residents want the offering',
    goalVerbPhrase: 'validate local customer demand',
    beneficiary: 'potential customers',
    motivation: 'avoid building without evidence',
    mechanism: 'customer discovery interviews',
    timeHorizon: 'months',
    risk: 'low',
    facet: 'demand validation',
    summary: (subject) =>
      `Interview nearby residents about when they would use ${subject} and what they currently choose instead.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} to learn whether residents will choose it for a need existing options do not meet.`,
    assumption: (subject) =>
      `This direction assumes local residents have an unmet need that ${subject} could serve.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} as a possible way to serve people in your neighborhood.`,
    changedAssumption: (subject) =>
      `It treats local demand as something to verify, not an established reason for exploring ${subject}.`,
    fitRationale: (subject) =>
      `Resident interviews can reveal whether ${subject} meets a real local need before you invest in a permanent launch.`,
    strongestObjection: (subject) =>
      `Residents may like the concept but still prefer familiar alternatives to ${subject}.`,
    firstTest: (subject) =>
      `Describe ${subject} to five nearby residents and ask where they would use it, when they would visit, and what would make them choose it.`,
    falsifier: (subject) =>
      `If residents report that existing options already meet the need and would not choose ${subject}, the demand hypothesis weakens.`,
  },
  {
    key: 'build-community',
    title: (subject) => `Create a gathering place around ${subject}`,
    goalNounPhrase: 'a dependable source of connection among neighbors',
    goalVerbPhrase: 'bring neighbors together through recurring gatherings',
    beneficiary: 'people facing the same challenge',
    motivation: 'replace isolation with belonging',
    mechanism: 'a small recurring peer gathering',
    timeHorizon: 'months',
    risk: 'medium',
    facet: 'community',
    summary: (subject) =>
      `Host a recurring neighbor gathering to test whether ${subject} can give people a welcoming reason to meet.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} as a way to create a dependable place for neighbors to connect.`,
    assumption: (subject) =>
      `This direction assumes neighbors want a regular place to meet through ${subject}.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} not only as an offering, but also as a way to bring neighbors together.`,
    changedAssumption: (subject) =>
      `It treats community-building as a possible goal for ${subject}, rather than assuming it is your main motivation.`,
    fitRationale: (subject) =>
      `A small recurring gathering would test whether ${subject} can support relationships, not just one-time visits.`,
    strongestObjection: (subject) =>
      `A successful first gathering may not lead to repeat attendance or lasting relationships around ${subject}.`,
    firstTest: (subject) =>
      `Invite six neighbors to a one-hour meetup related to ${subject}, then count attendance and ask who wants to return next week.`,
    falsifier: (subject) =>
      `If few neighbors attend or ask to return after a gathering related to ${subject}, a recurring community may not be the strongest direction.`,
  },
  {
    key: 'reduce-cost',
    title: (subject) => `Test a low-cost version of ${subject}`,
    goalNounPhrase: 'an operating model that remains affordable to sustain',
    goalVerbPhrase: 'make the offering affordable to sustain',
    beneficiary: 'the person running the project',
    motivation: 'protect scarce resources',
    mechanism: 'a low-cost manual workflow',
    timeHorizon: 'immediate',
    risk: 'low',
    facet: 'cost reduction',
    summary: (subject) =>
      `Run a limited, manual version of ${subject} to find which recurring costs rise before you commit to a permanent setup.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} to learn what would make the operation affordable at a small scale.`,
    assumption: (subject) =>
      `This direction assumes that reducing ongoing costs would make ${subject} easier to sustain.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} while keeping its financial sustainability in view.`,
    changedAssumption: (subject) =>
      `It treats an affordable operating model as a possible priority for ${subject}, not as a confirmed constraint.`,
    fitRationale: (subject) =>
      `A small manual trial can expose the costs of ${subject} before you take on fixed expenses.`,
    strongestObjection: (subject) =>
      `A low-cost trial may leave out expenses that appear only when ${subject} operates at full scale.`,
    firstTest: (subject) =>
      `Sell a limited preorder batch tied to ${subject}, then compare ingredient, labor, and space costs with revenue by Friday.`,
    falsifier: (subject) =>
      `If the variable costs of ${subject} already exceed what customers will pay, a lean operating model may not be enough.`,
  },
  {
    key: 'learn-skill',
    title: (subject) => `Learn by building ${subject}`,
    goalNounPhrase: 'practical capability gained through repeated practice',
    goalVerbPhrase: 'build practical capability through practice',
    beneficiary: 'the user as a learner',
    motivation: 'gain confidence by doing',
    mechanism: 'a small public practice project',
    timeHorizon: 'months',
    risk: 'medium',
    facet: 'skill building',
    summary: (subject) =>
      `Turn one part of ${subject} into a hands-on learning project by practicing a useful skill in a small, public prototype.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} to build practical skills through a real project rather than study alone.`,
    assumption: (subject) =>
      `This direction assumes you would value learning by making a small version of ${subject}.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} as a project that could teach you something useful along the way.`,
    changedAssumption: (subject) =>
      `It treats skill-building as a possible benefit of ${subject}, not as your only reason for exploring it.`,
    fitRationale: (subject) =>
      `A small prototype of ${subject} would let you practice a real skill while learning what the larger idea requires.`,
    strongestObjection: (subject) =>
      `Building ${subject} may require operational expertise you do not want to develop right now.`,
    firstTest: (subject) =>
      `Make three small prototypes related to ${subject}, share them with five peers, and ask them to rate clarity and usefulness by Sunday.`,
    falsifier: (subject) =>
      `If making a small version of ${subject} teaches you little or feels unrelated to your aim, skill-building may not be the best route.`,
  },
  {
    key: 'create-income',
    title: (subject) => `Test an early revenue model for ${subject}`,
    goalNounPhrase: 'a small but reliable revenue stream',
    goalVerbPhrase: 'earn revenue through a focused paid offer',
    beneficiary: 'the user and their household',
    motivation: 'increase financial independence',
    mechanism: 'a paid, narrowly scoped offer',
    timeHorizon: 'immediate',
    risk: 'high',
    facet: 'income',
    summary: (subject) =>
      `Pre-sell one focused offer connected to ${subject} to learn who will pay before you expand the scope.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} to discover whether customers will pay for a focused offer.`,
    assumption: (subject) =>
      `This direction assumes there are customers willing to pay for an early version of ${subject}.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} as a possible source of value for customers and income for its operator.`,
    changedAssumption: (subject) =>
      `It treats early revenue as one possible outcome of ${subject}, not as an established goal.`,
    fitRationale: (subject) =>
      `A paid pilot of ${subject} can reveal willingness to pay before you invest in a wider offering.`,
    strongestObjection: (subject) =>
      `Initial buyers may not return often enough to cover the ongoing costs of ${subject}.`,
    firstTest: (subject) =>
      `Offer a paid pilot tied to ${subject} to ten likely buyers, state one clear outcome, and count commitments within seven days.`,
    falsifier: (subject) =>
      `If likely customers will not pay for a narrow version of ${subject}, an early revenue model may need a different offer.`,
  },
  {
    key: 'help-someone',
    title: (subject) => `Serve one customer's need through ${subject}`,
    goalNounPhrase: "a concrete improvement in one person's day",
    goalVerbPhrase: "solve one person's concrete problem",
    beneficiary: 'one person the user knows',
    motivation: 'make a direct difference',
    mechanism: 'a tailored one-to-one service',
    timeHorizon: 'immediate',
    risk: 'low',
    facet: 'direct service',
    summary: (subject) =>
      `Work with one nearby customer to tailor a small part of ${subject} to a need they cannot meet with the usual options.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} because helping one person well could be more valuable than serving everyone at once.`,
    assumption: (subject) =>
      `This direction assumes one nearby person has a specific need that ${subject} could address.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} as a way to make a practical difference for someone in your community.`,
    changedAssumption: (subject) =>
      `It treats direct service to one person as a possible starting point for ${subject}, not as the whole ambition.`,
    fitRationale: (subject) =>
      `Working with one person can uncover details about ${subject} that broad market research would miss.`,
    strongestObjection: (subject) =>
      `A solution tailored to one person may not work for the broader audience of ${subject}.`,
    firstTest: (subject) =>
      `Ask one neighbor about a current obstacle related to ${subject}, offer a tailored small-scale solution, and check whether the obstacle eases by Friday.`,
    falsifier: (subject) =>
      `If a tailored trial of ${subject} does not reduce the person's obstacle, this service-first direction may be mistaken.`,
  },
  {
    key: 'reduce-risk',
    title: (subject) => `Test the riskiest assumption behind ${subject}`,
    goalNounPhrase: "early evidence about the venture's biggest risk",
    goalVerbPhrase: 'test the riskiest assumption before committing resources',
    beneficiary: 'the user before committing',
    motivation: 'limit avoidable losses',
    mechanism: 'a reversible low-cost experiment',
    timeHorizon: 'immediate',
    risk: 'high',
    facet: 'risk reduction',
    summary: (subject) =>
      `Find the assumption most likely to derail ${subject}, then test it with a reversible experiment before making a large commitment.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} cautiously and want to find its largest risk before investing heavily.`,
    assumption: (subject) =>
      `This direction assumes that an early test of ${subject} can expose a risk that would be costly to discover later.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} while looking for a way to limit avoidable downside.`,
    changedAssumption: (subject) =>
      `It treats early risk reduction as a possible priority for ${subject}, not as evidence that the idea is unsafe.`,
    fitRationale: (subject) =>
      `A reversible experiment can challenge the riskiest part of ${subject} without locking you into a full launch.`,
    strongestObjection: (subject) =>
      `A small experiment may not capture the operational complexity that appears when ${subject} scales up.`,
    firstTest: (subject) =>
      `List three assumptions behind ${subject}, choose the one whose failure would be most expensive, and run a no-commitment test by Friday.`,
    falsifier: (subject) =>
      `If the largest risks behind ${subject} cannot be tested cheaply or reversibly, this experiment-first approach may not resolve the uncertainty.`,
  },
  {
    key: 'long-term-leverage',
    title: (subject) => `Build a reusable asset from ${subject}`,
    goalNounPhrase: 'a reusable asset that compounds over time',
    goalVerbPhrase: 'build an asset that compounds over time',
    beneficiary: 'future users and collaborators',
    motivation: 'make progress reusable over time',
    mechanism: 'a reusable guide or digital resource',
    timeHorizon: 'years',
    risk: 'medium',
    facet: 'long-term leverage',
    summary: (subject) =>
      `Turn one repeatable part of ${subject} into a guide or resource that can help future customers without requiring a new conversation each time.`,
    hypothesis: (subject) =>
      `You may be exploring ${subject} as a source of knowledge or tools that can keep helping people over time.`,
    assumption: (subject) =>
      `This direction assumes a useful part of ${subject} can be captured and reused by others.`,
    preservedIntent: (subject) =>
      `You are considering ${subject} as a way to create value that can extend beyond one-time interactions.`,
    changedAssumption: (subject) =>
      `It treats a reusable resource as a possible outcome of ${subject}, not as a confirmed business model.`,
    fitRationale: (subject) =>
      `A reusable guide can test whether one part of ${subject} remains valuable after the first person uses it.`,
    strongestObjection: (subject) =>
      `A resource made from ${subject} may be too broad to attract attention or create value on its own.`,
    firstTest: (subject) =>
      `Write a one-page guide to one repeatable part of ${subject}, share it with ten readers, and track downloads and follow-up questions for a week.`,
    falsifier: (subject) =>
      `If readers do not use or share a small resource from ${subject}, a compounding asset may not be the most useful direction.`,
  },
]

function makeCandidate(
  archetype: Archetype,
  subject: string,
  factRef?: string,
): FrameCandidate {
  const axes: Axes = {
    goal: archetype.goalVerbPhrase,
    beneficiary: archetype.beneficiary,
    motivation: archetype.motivation,
    mechanism: archetype.mechanism,
    timeHorizon: archetype.timeHorizon,
    risk: archetype.risk,
  }
  return {
    key: archetype.key,
    title: archetype.title(subject).slice(0, 120),
    summary: archetype.summary(subject),
    hypothesis: {
      statement: archetype.hypothesis(subject),
      axes,
      assumptions: [archetype.assumption(subject)],
      supportingFactRefs: factRef ? [factRef] : [],
      counterevidence: [],
      falsifiers: [archetype.falsifier(subject)],
    },
    preservedIntent: archetype.preservedIntent(subject),
    changedAssumptions: [archetype.changedAssumption(subject)],
    fitRationale: archetype.fitRationale(subject),
    strongestObjection: archetype.strongestObjection(subject),
    firstTest: archetype.firstTest(subject),
    mechanism: archetype.mechanism,
    facets: [archetype.facet, archetype.goalNounPhrase],
    distance: archetype.key === 'validate-demand' ? 'near' : 'adjacent',
  }
}

function getSubject(prompt: string) {
  let phrase = prompt
    .normalize('NFKC')
    .replace(/[“”"`]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[.!?;:]+$/, '')
    .trim()

  phrase = phrase.replace(
    /^(?:i\s+want\s+to|i\s+want|i(?:'|’)d\s+like\s+to|i\s+would\s+like\s+to|help\s+me|how\s+can\s+i|i(?:'|’)m\s+thinking\s+about|i\s+am\s+thinking\s+about)\s+/i,
    '',
  )

  const leadingAction =
    /^(?:(?:explore|test|start|build|make|figure\s+out|understand|launch|create|develop|open|try|plan|whether|how\s+to)\s+)+/i
  let previousPhrase = ''
  while (phrase !== previousPhrase) {
    previousPhrase = phrase
    phrase = phrase.replace(leadingAction, '')
  }

  phrase = phrase.replace(
    /^(?:an?\s+|the\s+)?(?:idea|concept|project|plan)\s+(?:of|for)\s+/i,
    '',
  )
  const sentenceBoundary = phrase.search(/[.!?](?=\s|$)/)
  if (sentenceBoundary >= 0) phrase = phrase.slice(0, sentenceBoundary)
  const clauseBoundary =
    /\b(?:for|who|that|which|so|because|whether|to|where|when|while|if|can|could|should|will|would|may|might|must|is|are|has|have|needs?|wants?)\b|[,;:]/i
  const boundaryIndex = phrase.search(clauseBoundary)
  if (boundaryIndex >= 0) phrase = phrase.slice(0, boundaryIndex)

  const subject = phrase
    .replace(/\b(?:idea|concept|project|plan|initiative)\s*$/i, '')
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1')
    .replace(/[.,!?;:]+$/, '')
    .trim()
  if (
    !subject ||
    /^(?:a|an|the|this|that|some|something|anything)$/i.test(subject)
  ) {
    return 'this idea'
  }
  return subject
}

function stableHash(value: string) {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function embedText(value: string) {
  const stopWords = new Set([
    'a',
    'about',
    'and',
    'by',
    'for',
    'from',
    'in',
    'of',
    'on',
    'or',
    'the',
    'to',
    'with',
  ])
  const vector = Array.from({ length: 64 }, () => 0)
  for (const token of value.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (stopWords.has(token)) continue
    let hash = 2166136261
    for (const char of token) {
      hash ^= char.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    }
    vector[(hash >>> 0) % vector.length]! += 1
  }
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value ** 2, 0),
  )
  return magnitude ? vector.map((value) => value / magnitude) : vector
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new ProviderError('Model request timed out', 'TIMEOUT')
  }
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () =>
      reject(new ProviderError('Model request timed out', 'TIMEOUT'))
    signal.addEventListener('abort', fail, { once: true })
    if (signal.aborted) fail()
  })
}
