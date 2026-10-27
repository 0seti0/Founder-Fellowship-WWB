import type {
  Axes,
  CandidateEvaluation,
  EvaluateOutput,
  ExtractedConstraint,
  ExtractedFact,
  ExtractionOutput,
  IdeaContent,
  FrameCandidate,
  FrameOutput,
  MockScenario,
  UnaryOperator,
} from '@unfold/shared'
import type { ModelMode } from '@unfold/shared'

export type GenerationTask = 'extract' | 'frame' | 'evaluate' | 'expand'

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
    return `Test whether a small ${fixture.method} can ${fixture.goal} for ${values.beneficiary}.`
  if (operator === 'REFRAME')
    return `Serve ${values.beneficiary} through ${fixture.method}, measuring whether it can ${fixture.goal}.`
  if (operator === 'LEAP')
    return `Keep the original intent, but use ${fixture.method} to ${fixture.goal} for ${values.beneficiary}.`
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
      if (request.task === 'expand' && this.shouldBeInvalid(attempt)) {
        return { operator: 'GROUND', candidates: [] }
      }
    }

    switch (request.task) {
      case 'extract':
        return this.extract(request.input, attempt)
      case 'frame':
        return this.frame(request.input)
      case 'evaluate':
        return this.evaluate(request.input)
      case 'expand':
        return this.expand(request.input)
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

  private frame(input: unknown): FrameOutput {
    const { prompt, facts } = input as {
      prompt: string
      facts: ExtractedFact[]
      constraints: ExtractedConstraint[]
    }
    const cleanedPrompt = prompt.replace(
      /\bno[-‐‑](\p{L}+)/giu,
      (modifier, word: string) =>
        hyphenatedNoModifiers.has(word.toLowerCase()) ? modifier : '',
    )
    const subject = getSubject(cleanedPrompt)
    const cues = getTitleCues(cleanedPrompt, subject)
    const firstFactRef = facts[0]?.ref
    const offset = stableHash(prompt) % archetypes.length
    const selected = Array.from({ length: 6 }, (_, index) => {
      const archetype = archetypes[(offset + index) % archetypes.length]!
      return makeCandidate(archetype, subject, cues, firstFactRef)
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
    const beneficiary = parent.hypothesis.axes.beneficiary
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

type TitleCues = { offering: string; audience: string }

type Archetype = {
  key: string
  title: (subject: string, cues: TitleCues) => string
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
    title: (_subject, cues) =>
      `Learn whether ${cues.audience} would choose ${cues.offering} over today's options`,
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
    title: (_subject, cues) =>
      `Turn ${cues.offering} into a weekly gathering for ${cues.audience}`,
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
    title: (_subject, cues) =>
      `Run a lean, manual version of ${cues.offering} before taking on fixed costs`,
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
    title: (_subject, cues) =>
      `Learn the craft by running ${cues.offering} one weekend at a time`,
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
    title: (_subject, cues) =>
      `Test an early revenue model for ${cues.offering}`,
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
    title: (_subject, cues) =>
      `Solve one recurring problem for ${cues.audience} through ${cues.offering}`,
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
    title: (_subject, cues) =>
      `Stress-test the assumption ${cues.offering} depends on most`,
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
    title: (_subject, cues) =>
      `Turn ${cues.offering} into a playbook other places could reuse`,
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
  cues: TitleCues,
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
    title: archetype.title(subject, cues).slice(0, 120),
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

const cueBoundary = new Set([
  'that',
  'which',
  'who',
  'for',
  'to',
  'in',
  'and',
  'or',
  'with',
  'where',
  'while',
  'so',
  'because',
  'but',
])

function cuePhrase(text: string, maxWords: number) {
  const words: string[] = []
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(/[^\p{L}\p{N}'’-]+$/u, '')
    if (!word || cueBoundary.has(word.toLowerCase())) break
    words.push(word)
    if (word !== raw || words.length >= maxWords) break
  }
  return words.join(' ')
}

function getTitleCues(prompt: string, subject: string): TitleCues {
  const offeringMatch =
    /\b(?:support|sustain|open|start|run|launch|build|make|create)\s+(?:an?\s+|the\s+|my\s+)?([\p{L}][\s\S]*)/iu.exec(
      prompt,
    )
  const offeringNoun = offeringMatch ? cuePhrase(offeringMatch[1]!, 2) : ''
  const offering =
    offeringNoun &&
    /^(?:my|our|the)\s/i.test(subject) &&
    !subject.toLowerCase().includes(offeringNoun.toLowerCase())
      ? `${/^[aeiou]/i.test(offeringNoun) ? 'an' : 'a'} ${offeringNoun} in ${subject}`
      : subject
  const audienceMatch =
    /\b(?:helps?|helping|serves?|serving|for)\s+(?!an?\b|the\b|my\b|this\b)([\p{L}][\s\S]*)/iu.exec(
      prompt,
    )
  const audience =
    (audienceMatch ? cuePhrase(audienceMatch[1]!, 3) : '').toLowerCase() ||
    'the people it serves'
  return { offering, audience }
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
