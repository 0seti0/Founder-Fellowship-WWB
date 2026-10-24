import { describe, expect, it } from 'vitest'
import type {
  ExtractedConstraint,
  FrameCandidate,
  MockScenario,
} from '@unfold/shared'
import {
  createModelProvider,
  evaluateHardConstraint,
  type ModelProvider,
} from '../src/model/provider'
import {
  generatePipeline,
  PipelineError,
  selectCandidates,
  type ScoredCandidate,
} from '../src/generation/pipeline'

const prompt = 'I want to open a bakery for neighbors.'
const timeoutMs = 100

async function generateForPrompt(
  generationPrompt: string,
  mockScenario?: MockScenario,
) {
  return generatePipeline({
    prompt: generationPrompt,
    provider: createModelProvider({ MODEL_MODE: 'mock' }, { mockScenario }),
    timeoutMs,
  })
}

async function generate(mockScenario?: MockScenario) {
  return generateForPrompt(prompt, mockScenario)
}

const contactTerms =
  /\b(?:contact|interview|ask|invite|survey|call|email|message|talk|meet|reach(?:\s+out)?)(?:s|ed|ing)?\b/i

const candidateText = (candidate: ScoredCandidate) =>
  [
    candidate.content.title,
    candidate.content.summary,
    candidate.content.mechanism,
    candidate.content.firstTest,
  ].join(' ')

function makeConstraintCandidate(firstTest: string): FrameCandidate {
  return {
    key: 'constraint-test',
    title: 'Neighborhood bakery direction',
    summary: 'A small bakery trial for nearby residents.',
    hypothesis: {
      statement: 'A focused bakery trial could test local interest.',
      axes: {
        goal: 'test demand',
        beneficiary: 'neighbors',
        motivation: 'convenience',
        mechanism: 'sample batch',
        timeHorizon: 'months',
        risk: 'low',
      },
      assumptions: ['Nearby residents are interested.'],
      supportingFactRefs: [],
      counterevidence: [],
      falsifiers: ['The trial does not attract interest.'],
    },
    preservedIntent: 'Explore a neighborhood bakery.',
    changedAssumptions: ['Start with one local trial.'],
    fitRationale: 'A small trial provides useful evidence.',
    strongestObjection: 'The trial may not represent demand.',
    firstTest,
    mechanism: 'Bake a sample tray and record the result.',
    facets: ['local trial'],
    distance: 'near',
  }
}

function makeHardConstraint(evidence: string): ExtractedConstraint {
  return {
    ref: 'c1',
    text: evidence,
    evidence,
    strength: 'hard',
    basis: 'explicit',
  }
}

const selectionFacets = [
  'audience',
  'accessibility',
  'cost',
  'convenience',
  'learning',
  'trust',
]

type SelectionLabels = Record<
  'intentAlignment' | 'usefulness' | 'specificity',
  'low' | 'medium' | 'high'
>

function makeSelectionCandidate(
  ordinal: number,
  axes: FrameCandidate['hypothesis']['axes'],
  labelOverrides: Partial<SelectionLabels> = {},
): ScoredCandidate {
  const content: FrameCandidate = {
    key: `selection-${ordinal}`,
    title: `Selection candidate ${ordinal}`,
    summary: 'A concrete direction for testing the idea.',
    hypothesis: {
      statement: `A direction for candidate ${ordinal}.`,
      axes,
      assumptions: ['The audience is reachable.'],
      supportingFactRefs: [],
      counterevidence: [],
      falsifiers: ['A simple test disproves the direction.'],
    },
    preservedIntent: 'Explore the idea.',
    changedAssumptions: ['Use a focused initial audience.'],
    fitRationale: 'It offers a concrete next step.',
    strongestObjection: 'The audience may not respond.',
    firstTest: 'Run a small test with a clear success measure.',
    mechanism: 'Use a simple prototype.',
    facets: [...selectionFacets],
    distance: 'near',
  }
  const labels: SelectionLabels = {
    intentAlignment: labelOverrides.intentAlignment ?? 'high',
    usefulness: labelOverrides.usefulness ?? 'high',
    specificity: labelOverrides.specificity ?? 'high',
  }
  const scoreLabel = (label: SelectionLabels[keyof SelectionLabels]) =>
    label === 'high' ? 2 : label === 'medium' ? 1 : 0
  const qualityScore =
    (0.45 * scoreLabel(labels.intentAlignment) +
      0.35 * scoreLabel(labels.usefulness) +
      0.2 * scoreLabel(labels.specificity)) /
    2

  return {
    id: `selection-${ordinal}`,
    ordinal,
    content,
    evaluation: {
      candidateKey: content.key,
      constraints: [],
      intentAlignment: {
        label: labels.intentAlignment,
        rationale: 'The direction fits the prompt.',
      },
      usefulness: {
        label: labels.usefulness,
        rationale: 'The direction supports a practical test.',
      },
      specificity: {
        label: labels.specificity,
        rationale: 'The direction has a concrete scope.',
      },
    },
    qualityScore,
    completeness: {},
    genericFirstTest: false,
    eligibility: 'ELIGIBLE',
    rejectionReasons: [],
    selectionState: 'NOT_SELECTED',
    duplicateOfCandidateId: null,
    dedupSimilarity: null,
    selectionScore: null,
    selectionProbability: 0,
    selectionMetadata: {},
    displayPosition: null,
    hypothesisSupportingFactIds: [],
  }
}

function expectContactProhibition(
  result: Awaited<ReturnType<typeof generateForPrompt>>,
) {
  const hardConstraint = result.constraints.find(
    ({ item }) => 'strength' in item && item.strength === 'hard',
  )
  expect(hardConstraint).toBeDefined()
  const constraintRef = hardConstraint!.item.ref
  const displayed = result.candidates.filter(
    (candidate) => candidate.selectionState === 'SELECTED',
  )

  expect(displayed.length).toBeGreaterThan(0)
  for (const candidate of displayed) {
    expect(candidateText(candidate)).not.toMatch(contactTerms)
  }

  const violated = result.candidates.filter((candidate) =>
    candidateText(candidate).match(contactTerms),
  )
  expect(violated.length).toBeGreaterThan(0)
  for (const candidate of violated) {
    expect(candidate.eligibility).toBe('REJECTED')
    expect(candidate.rejectionReasons).toContain(
      `HARD_CONSTRAINT_VIOLATED:${constraintRef}`,
    )
  }
}

describe('initial generation pipeline', () => {
  it('records exact evidence spans from the prompt', async () => {
    const result = await generate()

    expect(result.facts.length).toBeGreaterThan(0)
    for (const span of result.facts) {
      expect(prompt.slice(span.start, span.end)).toBe(span.item.evidence)
    }
    expect(result.candidates).toHaveLength(6)
  })

  it('uses clean noun-phrase subjects and distinct candidate prose', async () => {
    const prompts = [
      {
        prompt:
          'I want to explore a neighborhood bakery idea for people who need a welcoming place to meet.',
        subject: 'a neighborhood bakery',
      },
      {
        prompt:
          "I'd like to start a community garden that gives neighbors space to grow fresh food.",
        subject: 'a community garden',
      },
      {
        prompt: 'How can I test whether my neighborhood can support a bakery?',
        subject: 'my neighborhood',
      },
    ]

    for (const { prompt: testPrompt, subject } of prompts) {
      const result = await generateForPrompt(testPrompt)
      expect(result.candidates).toHaveLength(6)

      const titles = result.candidates.map(
        (candidate) => candidate.content.title,
      )
      for (const title of titles) {
        expect(title).toContain(subject)
        expect(title).not.toMatch(/\b(\w+)\s+\1\b/i)
        expect(title).not.toMatch(/\bfor (?:explore|test|I)\b/i)
      }

      for (const field of [
        'summary',
        'mechanism',
        'strongestObjection',
        'firstTest',
      ] as const) {
        expect(
          new Set(
            result.candidates.map((candidate) => candidate.content[field]),
          ).size,
        ).toBe(6)
      }
    }
  })

  it('retries extraction once after malformed output or invalid evidence', async () => {
    for (const scenario of [
      'malformed-once',
      'invalid-evidence-once',
    ] as const) {
      const result = await generate(scenario)
      expect(
        result.attempts.filter((attempt) => attempt.task === 'extract'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ attempt: 1, ok: false }),
          expect.objectContaining({ attempt: 2, ok: true }),
        ]),
      )
    }
  })

  it('fails after two malformed outputs or invalid evidence attempts', async () => {
    for (const [scenario, code] of [
      ['malformed', 'MALFORMED_OUTPUT'],
      ['invalid-evidence', 'INVALID_EVIDENCE'],
    ] as const) {
      await expect(generate(scenario)).rejects.toMatchObject({
        code,
        attempts: expect.arrayContaining([
          expect.objectContaining({ task: 'extract', attempt: 2, ok: false }),
        ]),
      })
    }
  })

  it('rejects paraphrase sets after one retry', async () => {
    await expect(generate('paraphrase')).rejects.toMatchObject({
      code: 'PARAPHRASE_SET',
    })
  })

  it('rejects only violated hard constraints, not unknown constraints', async () => {
    const constrained = await generatePipeline({
      prompt: 'I want to open a bakery and must keep costs under $100.',
      provider: createModelProvider(
        { MODEL_MODE: 'mock' },
        { mockScenario: 'hard-violation' },
      ),
      timeoutMs,
    })

    expect(constrained.constraints[0]?.item).toMatchObject({
      strength: 'hard',
      basis: 'explicit',
    })
    expect(constrained.candidates[0]?.rejectionReasons).toContain(
      'HARD_CONSTRAINT_VIOLATED:c1',
    )
    expect(constrained.candidates[1]?.evaluation.constraints[0]?.status).toBe(
      'unknown',
    )
    expect(constrained.candidates[1]?.eligibility).toBe('ELIGIBLE')
  })

  it('rejects candidates that violate a contact prohibition', async () => {
    const result = await generateForPrompt(
      'I want to open a bakery. I must not contact anyone.',
    )
    expectContactProhibition(result)
  })

  it('extracts no-contact as a hard constraint and rejects contact candidates', async () => {
    const result = await generateForPrompt(
      'I want a no-contact customer service business.',
    )
    expect(
      result.constraints.some(
        ({ item }) =>
          'strength' in item &&
          item.strength === 'hard' &&
          /no-contact/i.test(item.evidence),
      ),
    ).toBe(true)
    expectContactProhibition(result)
  })

  it('extracts no-ads as a hard constraint', async () => {
    const result = await generateForPrompt(
      'Build a reading app for kids, no-ads.',
    )

    expect(
      result.constraints.some(
        ({ item }) =>
          'strength' in item &&
          item.strength === 'hard' &&
          /no-ads/i.test(item.evidence),
      ),
    ).toBe(true)
  })

  it('keeps no-code as a fact while enforcing a separate contact ban', async () => {
    const result = await generateForPrompt(
      'I want to build a no-code app. I must not contact anyone.',
    )

    expect(
      result.constraints.some(
        ({ item }) =>
          'strength' in item &&
          item.strength === 'hard' &&
          /no-code/i.test(item.evidence),
      ),
    ).toBe(false)
    expectContactProhibition(result)
  })

  it('checks every hyphenated ban in a constraint', () => {
    const constraint = makeHardConstraint('no-interviews and no-selling')

    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Sell a limited preorder batch to neighbors.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Interview five neighbors.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Bake a sample tray and post a sign-up sheet.'),
        constraint,
      ),
    ).toBe('unknown')
  })

  it('checks hyphenated bans alongside ordinary negations', () => {
    const constraint = makeHardConstraint(
      'I want a no-contact bakery and must not spend money.',
    )

    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Interview five neighbors.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Buy ingredients for a trial batch.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Bake a sample tray and post a sign-up sheet.'),
        constraint,
      ),
    ).toBe('unknown')
  })

  it('keeps coordinated actions inside an ordinary negation scope', () => {
    const constraint = makeHardConstraint('I must not buy or sell')

    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Sell a limited preorder batch to neighbors.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Buy ingredients for a trial batch.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Bake a sample tray and post a sign-up sheet.'),
        constraint,
      ),
    ).toBe('unknown')
  })

  it('splits coordinated actions at a new ordinary negation', () => {
    const constraint = makeHardConstraint(
      'I must not buy and must not contact customers',
    )

    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Interview five neighbors.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Buy ingredients for a trial batch.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Bake a sample tray and post a sign-up sheet.'),
        constraint,
      ),
    ).toBe('unknown')
  })

  it('ends an ordinary negation scope at but', () => {
    const constraint = makeHardConstraint(
      'I must not spend money but can borrow equipment',
    )

    expect(
      evaluateHardConstraint(
        makeConstraintCandidate("Borrow a friend's oven for a trial bake."),
        constraint,
      ),
    ).toBe('unknown')
  })

  it('ignores negated mentions of a hyphenated ban in candidate text', async () => {
    const constraint = makeHardConstraint(
      'I want a no-commitment neighborhood bakery trial',
    )

    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Run a no-commitment test by Friday.'),
        constraint,
      ),
    ).toBe('unknown')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Sign a commitment with a supplier.'),
        constraint,
      ),
    ).toBe('violated')
    expect(
      evaluateHardConstraint(
        makeConstraintCandidate('Do not contact anyone.'),
        makeHardConstraint('no-contact'),
      ),
    ).toBe('unknown')

    const result = await generateForPrompt(
      'I want a no-commitment neighborhood bakery trial.',
    )
    const riskCandidate = result.candidates.find((candidate) =>
      /no-commitment test/i.test(candidate.content.firstTest),
    )

    expect(
      result.constraints.some(
        ({ item }) =>
          'strength' in item &&
          item.strength === 'hard' &&
          /no-commitment/i.test(item.evidence),
      ),
    ).toBe(true)
    if (riskCandidate) {
      expect(
        riskCandidate.rejectionReasons.filter((reason) =>
          reason.startsWith('HARD_CONSTRAINT_VIOLATED:'),
        ),
      ).toEqual([])
    }
  })

  it('does not treat the no-code modifier as a hard constraint', async () => {
    const result = await generateForPrompt('I want to build a no-code app')
    const selected = result.candidates.filter(
      (candidate) => candidate.selectionState === 'SELECTED',
    )

    expect(selected.length).toBeGreaterThanOrEqual(2)
    expect(
      result.constraints.some(
        ({ item }) =>
          'strength' in item &&
          item.strength === 'hard' &&
          /no-code/i.test(item.evidence),
      ),
    ).toBe(false)
  })

  it('selects two eligible candidates that differ on only one axis', () => {
    const firstAxes: FrameCandidate['hypothesis']['axes'] = {
      goal: 'learn',
      beneficiary: 'families',
      motivation: 'convenience',
      mechanism: 'newsletter',
      timeHorizon: 'months',
      risk: 'low',
    }
    const candidates = [
      makeSelectionCandidate(1, firstAxes),
      makeSelectionCandidate(2, { ...firstAxes, goal: 'build' }),
    ]

    selectCandidates(candidates, candidates, [
      [1, 0],
      [0, 1],
    ])

    expect(candidates.map((candidate) => candidate.selectionState)).toEqual([
      'SELECTED',
      'SELECTED',
    ])
  })

  it('keeps quality dominant over axis coverage and bounds the coverage bonus', () => {
    const firstAxes: FrameCandidate['hypothesis']['axes'] = {
      goal: 'learn',
      beneficiary: 'families',
      motivation: 'convenience',
      mechanism: 'newsletter',
      timeHorizon: 'months',
      risk: 'low',
    }
    const first = makeSelectionCandidate(1, firstAxes)
    const higherQuality = makeSelectionCandidate(2, {
      ...firstAxes,
      goal: 'build',
    })
    const broaderCoverage = makeSelectionCandidate(
      3,
      {
        goal: 'launch',
        beneficiary: 'teachers',
        motivation: 'growth',
        mechanism: 'marketplace',
        timeHorizon: 'years',
        risk: 'high',
      },
      { specificity: 'medium' },
    )
    const candidates = [first, higherQuality, broaderCoverage]

    selectCandidates(candidates, candidates, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])

    expect(first.selectionState).toBe('SELECTED')
    expect(higherQuality.selectionState).toBe('SELECTED')
    expect(higherQuality.displayPosition).toBe(2)
    expect(broaderCoverage.displayPosition).toBe(3)

    const selected = candidates.filter(
      (candidate) => candidate.selectionState === 'SELECTED',
    )
    for (const candidate of selected) {
      const components = candidate.selectionMetadata.components as Record<
        string,
        unknown
      >
      const axisCoverageBonus = components.axisCoverageBonus as number
      expect(typeof axisCoverageBonus).toBe('number')
      expect(axisCoverageBonus).toBeGreaterThanOrEqual(0)
      expect(axisCoverageBonus).toBeLessThanOrEqual(0.04)
      if (candidate.displayPosition === 1) {
        expect(axisCoverageBonus).toBe(0)
      }
    }
    expect(
      (higherQuality.selectionMetadata.components as Record<string, unknown>)
        .axisCoverageBonus,
    ).toBe(0.02)
  })

  it('keeps Node.js in the generated subject', async () => {
    const result = await generateForPrompt(
      'I want to build a Node.js app. It must be done by Friday.',
    )
    const selectedTitles = result.candidates
      .filter((candidate) => candidate.selectionState === 'SELECTED')
      .map((candidate) => candidate.content.title)

    expect(selectedTitles.length).toBeGreaterThan(0)
    for (const title of selectedTitles) {
      expect(title).toContain('Node.js app')
    }
  })

  it('keeps .NET in the generated subject', async () => {
    const result = await generateForPrompt(
      'I want to build a .NET tool for my team.',
    )
    const selectedTitles = result.candidates
      .filter((candidate) => candidate.selectionState === 'SELECTED')
      .map((candidate) => candidate.content.title)

    expect(selectedTitles.length).toBeGreaterThan(0)
    for (const title of selectedTitles) {
      expect(title).toContain('.NET tool')
    }
  })

  it('rejects low quality and generic first tests', async () => {
    const result = await generate('low-quality')
    expect(result.candidates[0]?.rejectionReasons).toContain(
      'LOW_QUALITY:intentAlignment',
    )
    expect(result.candidates[0]?.rejectionReasons).toContain(
      'GENERIC_FIRST_TEST',
    )
    expect(result.candidates[0]?.genericFirstTest).toBe(true)
  })

  it('shows fewer than four directions when only two candidates pass', async () => {
    const result = await generate('few-pass')
    expect(
      result.candidates.filter(
        (candidate) => candidate.selectionState === 'SELECTED',
      ),
    ).toHaveLength(2)
  })

  it('never selects a weak candidate for diversity', async () => {
    const result = await generate('weak-diverse')
    expect(result.candidates[5]?.eligibility).toBe('REJECTED')
    expect(result.candidates[5]?.selectionState).toBe('REJECTED')
  })

  it('clusters near-duplicate candidates by embedding similarity', async () => {
    const result = await generate('duplicates')
    expect(result.dedupMode).toBe('EMBEDDING')
    expect(result.candidates[1]?.selectionState).toBe('DUPLICATE')
    expect(result.candidates[1]?.duplicateOfCandidateId).toBe(
      result.candidates[0]?.id,
    )
    expect(result.candidates[1]?.dedupSimilarity).toBeGreaterThanOrEqual(0.92)
  })

  it('uses a documented text fallback and marks degraded runs on embedding failure', async () => {
    const result = await generate('embedding-failure')
    expect(result.dedupMode).toBe('TEXT_FALLBACK')
    expect(result.degraded).toBe(true)
    expect(result.degradationReason).toContain('Mock embedding failure')
  })

  it('clusters a text-fallback pair at approximately 0.85 Jaccard similarity', async () => {
    const baseProvider = createModelProvider(
      { MODEL_MODE: 'mock' },
      { mockScenario: 'embedding-failure' },
    )
    const provider: ModelProvider = {
      identity: baseProvider.identity,
      async generateStructured(request) {
        const output = await baseProvider.generateStructured(request)
        if (request.task !== 'frame') return output

        const { candidates } = output as { candidates: FrameCandidate[] }
        return {
          candidates: candidates.map((candidate, index) => {
            if (index === 0) {
              return {
                ...candidate,
                title: 'alpha bravo charlie delta echo foxtrot golf',
                summary:
                  'hotel india juliet kilo lima mike november oscar papa',
                mechanism: 'quebec romeo',
              }
            }
            if (index === 1) {
              return {
                ...candidate,
                title: 'alpha bravo charlie delta echo foxtrot golf',
                summary:
                  'hotel india juliet kilo lima mike november oscar papa',
                mechanism: 'quebec sierra tango',
              }
            }
            return candidate
          }),
        }
      },
      embed: (texts, signal) => baseProvider.embed(texts, signal),
    }

    const result = await generatePipeline({
      prompt,
      provider,
      timeoutMs,
    })
    expect(result.dedupMode).toBe('TEXT_FALLBACK')
    expect(result.candidates[1]?.selectionState).toBe('DUPLICATE')
    expect(result.candidates[1]?.dedupSimilarity).toBeCloseTo(0.85)
    expect(result.candidates[1]?.duplicateOfCandidateId).toBe(
      result.candidates[0]?.id,
    )
  })

  it('records deterministic initial MMR selection metadata', async () => {
    const result = await generate()
    const selected = result.candidates.filter(
      (candidate) => candidate.selectionState === 'SELECTED',
    )
    expect(selected.length).toBeLessThanOrEqual(4)
    expect(selected[0]?.selectionMetadata).toMatchObject({
      policyVersion: 'initial-mmr-v2',
      randomized: false,
      note: 'deterministic policy; selectionProbability is not a propensity for off-policy evaluation',
      rank: 1,
    })
    expect(selected[0]?.selectionProbability).toBe(1)
    expect(
      result.candidates.find(
        (candidate) => candidate.selectionState !== 'SELECTED',
      )?.selectionProbability,
    ).toBe(0)
  })

  it('does not fall back to mock when the live provider is unimplemented', async () => {
    const provider = createModelProvider({ MODEL_MODE: 'live' })
    await expect(
      provider.generateStructured({
        task: 'extract',
        promptVersion: 'extract-v1',
        schemaVersion: 'stage1-v1',
        system: '',
        input: { prompt },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(provider.identity.provider).toBe('live')
  })

  it('keeps typed pipeline errors for callers', async () => {
    try {
      await generate('malformed')
      throw new Error('Expected generation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineError)
    }
  })
})
