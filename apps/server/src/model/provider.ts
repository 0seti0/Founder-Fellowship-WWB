import type {
  Axes,
  CandidateEvaluation,
  EvaluateOutput,
  ExtractedConstraint,
  ExtractedFact,
  ExtractionOutput,
  FrameCandidate,
  FrameOutput,
  MockScenario,
} from '@unfold/shared'
import type { ModelMode } from '@unfold/shared'

export type GenerationTask = 'extract' | 'frame' | 'evaluate'

export type StructuredGenerationRequest = {
  task: GenerationTask
  promptVersion: string
  schemaVersion: string
  system: string
  input: unknown
  signal: AbortSignal
}

export type ModelProvider = {
  identity: { provider: string; model: string }
  generateStructured(request: StructuredGenerationRequest): Promise<unknown>
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>
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

type ProviderEnvironment = {
  MODEL_MODE: ModelMode
}

export function createModelProvider(
  env: ProviderEnvironment,
  opts: { mockScenario?: MockScenario } = {},
): ModelProvider {
  if (env.MODEL_MODE === 'mock') {
    return new MockProvider(opts.mockScenario ?? 'default')
  }
  return new LiveProvider()
}

class LiveProvider implements ModelProvider {
  identity = { provider: 'live', model: 'unimplemented' }

  async generateStructured(): Promise<never> {
    throw new ProviderError('Live provider not implemented', 'PROVIDER_ERROR')
  }

  async embed(): Promise<never> {
    throw new ProviderError('Live provider not implemented', 'PROVIDER_ERROR')
  }
}

class MockProvider implements ModelProvider {
  identity = { provider: 'mock', model: 'mock-unfold-v1' }
  private readonly calls = new Map<GenerationTask, number>()

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
    }

    switch (request.task) {
      case 'extract':
        return this.extract(request.input, attempt)
      case 'frame':
        return this.frame(request.input)
      case 'evaluate':
        return this.evaluate(request.input)
    }
  }

  async embed(texts: string[], signal: AbortSignal): Promise<number[][]> {
    throwIfAborted(signal)
    if (this.scenario === 'embedding-failure') {
      throw new ProviderError('Mock embedding failure', 'PROVIDER_ERROR')
    }
    return texts.map(embedText)
  }

  private shouldBeInvalid(attempt: number) {
    return this.scenario === 'malformed' || attempt === 1
  }

  private extract(input: unknown, attempt: number): ExtractionOutput {
    const { prompt } = input as { prompt: string }
    const facts: ExtractedFact[] = []
    const constraints: ExtractedConstraint[] = []
    const explicitMarker =
      /\b(?:must|need to|have to|cannot|can't|don't want|no more than|under|only|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))?),?|within|without)\b/i
    const softMarker = /\b(?:ideally|prefer|would like|i'd like|hopefully)\b/i

    for (const rawClause of prompt.matchAll(/[^.!?;\n]+[.!?;]?/g)) {
      const clause = rawClause[0].trim()
      if (!clause) continue
      if (explicitMarker.test(clause)) {
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

  private frame(input: unknown): FrameOutput {
    const { prompt, facts } = input as {
      prompt: string
      facts: ExtractedFact[]
      constraints: ExtractedConstraint[]
    }
    const subject = getSubject(prompt)
    const firstFactRef = facts[0]?.ref
    const offset = stableHash(prompt) % archetypes.length
    const selected = Array.from({ length: 6 }, (_, index) => {
      const archetype = archetypes[(offset + index) % archetypes.length]!
      return makeCandidate(archetype, subject, prompt, firstFactRef)
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
    if (this.scenario === 'low-quality' && selected[0]) {
      selected[0].firstTest = 'Conduct some more research.'
    }
    return { candidates: selected }
  }

  private evaluate(input: unknown): EvaluateOutput {
    const { candidates, constraints } = input as {
      candidates: FrameCandidate[]
      constraints: ExtractedConstraint[]
    }
    const evaluations: CandidateEvaluation[] = candidates.map(
      (candidate, index) => {
        let label: 'low' | 'medium' | 'high' =
          index % 3 === 0 ? 'high' : 'medium'
        if (this.scenario === 'none-pass') label = 'low'
        if (this.scenario === 'few-pass' && index < candidates.length - 2)
          label = 'low'
        if (this.scenario === 'low-quality' && index === 0) label = 'low'
        if (this.scenario === 'weak-diverse' && index === 5) label = 'low'

        return {
          candidateKey: candidate.key,
          constraints: constraints.map((constraint, constraintIndex) => {
            let status: 'satisfied' | 'violated' | 'unknown' = 'satisfied'
            if (this.scenario === 'hard-violation') {
              if (index === 0 && constraint.strength === 'hard')
                status = 'violated'
              else if (index === 1 && constraint.strength === 'hard')
                status = 'unknown'
            } else if (
              constraint.strength === 'soft' ||
              (index === 2 && constraintIndex === 0)
            ) {
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
          intentAlignment: {
            label,
            rationale:
              label === 'low'
                ? 'The direction is not sufficiently aligned to the prompt.'
                : 'The direction preserves a plausible reading of the prompt.',
          },
          usefulness: {
            label,
            rationale:
              label === 'low'
                ? 'The direction is unlikely to help the user make progress.'
                : 'The direction offers a useful way to make progress.',
          },
          specificity: {
            label:
              this.scenario === 'low-quality' && index === 0 ? 'low' : label,
            rationale:
              this.scenario === 'low-quality' && index === 0
                ? 'The first test is generic rather than observable.'
                : 'The direction includes a concrete first test.',
          },
        }
      },
    )
    return { evaluations }
  }
}

type Archetype = {
  key: string
  title: string
  goal: string
  beneficiary: string
  motivation: string
  mechanism: string
  timeHorizon: Axes['timeHorizon']
  risk: Axes['risk']
  action: string
  object: string
  outcome: string
  facet: string
}

const archetypes: Archetype[] = [
  {
    key: 'validate-demand',
    title: 'Validate demand',
    goal: 'prove a real need exists',
    beneficiary: 'potential customers',
    motivation: 'avoid building without evidence',
    mechanism: 'customer discovery interviews',
    timeHorizon: 'months',
    risk: 'low',
    action: 'Interview 5 potential customers',
    object: 'their most urgent problem',
    outcome: 'record how many describe the same need this week',
    facet: 'demand validation',
  },
  {
    key: 'build-community',
    title: 'Build a peer community',
    goal: 'create a source of mutual support',
    beneficiary: 'people facing the same challenge',
    motivation: 'replace isolation with belonging',
    mechanism: 'a small recurring peer gathering',
    timeHorizon: 'months',
    risk: 'medium',
    action: 'Invite 6 peers to a one-hour gathering',
    object: 'a shared challenge',
    outcome: 'track how many accept and return next week',
    facet: 'community',
  },
  {
    key: 'reduce-cost',
    title: 'Reduce operating cost',
    goal: 'make the idea affordable to sustain',
    beneficiary: 'the person running the project',
    motivation: 'protect scarce resources',
    mechanism: 'a low-cost manual workflow',
    timeHorizon: 'immediate',
    risk: 'low',
    action: 'Run a one-week manual version',
    object: 'the highest recurring expense',
    outcome: 'compare its cost with the current approach by Friday',
    facet: 'cost reduction',
  },
  {
    key: 'learn-skill',
    title: 'Learn a practical skill',
    goal: 'build capability through practice',
    beneficiary: 'the user as a learner',
    motivation: 'gain confidence by doing',
    mechanism: 'a small public practice project',
    timeHorizon: 'months',
    risk: 'medium',
    action: 'Publish 3 practice examples',
    object: 'a beginner project in this area',
    outcome: 'ask 5 peers to rate clarity by Sunday',
    facet: 'skill building',
  },
  {
    key: 'create-income',
    title: 'Create a small income stream',
    goal: 'earn initial revenue',
    beneficiary: 'the user and their household',
    motivation: 'increase financial independence',
    mechanism: 'a paid, narrowly scoped offer',
    timeHorizon: 'immediate',
    risk: 'high',
    action: 'Offer a paid pilot to 10 likely buyers',
    object: 'one clearly described outcome',
    outcome: 'count paid commitments within 7 days',
    facet: 'income',
  },
  {
    key: 'help-someone',
    title: 'Help one specific person',
    goal: 'solve a concrete problem for someone else',
    beneficiary: 'one person the user knows',
    motivation: 'make a direct difference',
    mechanism: 'a tailored one-to-one service',
    timeHorizon: 'immediate',
    risk: 'low',
    action: 'Ask one person to try a tailored solution',
    object: 'their current obstacle',
    outcome: 'record whether the obstacle is reduced by Friday',
    facet: 'direct service',
  },
  {
    key: 'reduce-risk',
    title: 'Reduce the downside risk',
    goal: 'discover what could fail early',
    beneficiary: 'the user before committing',
    motivation: 'limit avoidable losses',
    mechanism: 'a reversible low-cost experiment',
    timeHorizon: 'immediate',
    risk: 'high',
    action: 'Prototype the riskiest assumption',
    object: 'a one-page test with 5 prospects',
    outcome: 'track objections and proceed-or-stop by Friday',
    facet: 'risk reduction',
  },
  {
    key: 'long-term-leverage',
    title: 'Build long-term leverage',
    goal: 'create an asset that compounds',
    beneficiary: 'future users and collaborators',
    motivation: 'make progress reusable over time',
    mechanism: 'a reusable guide or digital resource',
    timeHorizon: 'years',
    risk: 'medium',
    action: 'Publish a practical starter guide',
    object: 'the first repeatable part of the idea',
    outcome: 'track 10 downloads and 3 follow-up questions this month',
    facet: 'long-term leverage',
  },
]

function makeCandidate(
  archetype: Archetype,
  subject: string,
  prompt: string,
  factRef?: string,
): FrameCandidate {
  const axes: Axes = {
    goal: archetype.goal,
    beneficiary: archetype.beneficiary,
    motivation: archetype.motivation,
    mechanism: archetype.mechanism,
    timeHorizon: archetype.timeHorizon,
    risk: archetype.risk,
  }
  return {
    key: archetype.key,
    title: `${archetype.title} for ${subject}`.slice(0, 120),
    summary: `Explore ${subject} by ${archetype.mechanism}, using an initial test to learn whether ${archetype.goal}.`,
    hypothesis: {
      statement: `The deeper goal may be to ${archetype.goal} through ${archetype.mechanism}.`,
      axes,
      assumptions: [
        `The prompt's interest in ${subject} reflects a desire to ${archetype.goal}.`,
      ],
      supportingFactRefs: factRef ? [factRef] : [],
      counterevidence: [],
      falsifiers: [
        `If the first test produces no signal relevant to ${archetype.goal}, this hypothesis may be wrong.`,
      ],
    },
    preservedIntent: `Explore ${subject} without assuming a single route.`,
    changedAssumptions: [
      `Treat ${archetype.goal} as a possible deeper goal rather than an established intention.`,
    ],
    fitRationale: `This direction stays connected to “${subject}” while testing whether ${archetype.goal} would be useful.`,
    strongestObjection: `The prompt may be about a different outcome than ${archetype.goal}.`,
    firstTest: `${archetype.action} around ${archetype.object} and ${archetype.outcome}.`,
    mechanism: archetype.mechanism,
    facets: [archetype.facet, archetype.goal],
    distance: archetype.key === 'validate-demand' ? 'near' : 'adjacent',
  }
}

function getSubject(prompt: string) {
  const words = prompt
    .replace(/[“”"'`]/g, '')
    .split(/\s+/)
    .filter((word) => word && !subjectStopWords.has(word.toLowerCase()))
    .slice(0, 5)
  const subject = words.join(' ').replace(/[.,!?;:]+$/, '')
  return subject || 'your idea'
}

const subjectStopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'about',
  'for',
  'i',
  'it',
  'me',
  'my',
  'of',
  'to',
  'the',
  'want',
  'would',
])

function stableHash(value: string) {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function embedText(value: string) {
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
