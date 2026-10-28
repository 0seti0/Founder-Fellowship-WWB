import type { CandidateDto } from '@unfold/shared'
import { describe, expect, it } from 'vitest'
import {
  buildPresenterScript,
  rejectionLabel,
  type PresenterSource,
} from '../lib/presenterScript'

const prompt = 'I want a bakery. No ads.'

function rubric(scores: [number, number, number, number, number]) {
  const keys = [
    'intentCompatibility',
    'decisionUsefulness',
    'specificityCoherence',
    'firstTestExecutability',
    'nonObviousness',
  ] as const
  return {
    rubricVersion: 'candidate-rubric-v2' as const,
    criteria: Object.fromEntries(
      keys.map((key, index) => [
        key,
        { score: scores[index]!, rationale: 'r', weight: 0.2 },
      ]),
    ) as Extract<CandidateDto['quality'], { criteria: unknown }>['criteria'],
    q: 0.8,
    floor: { passed: true, failures: [] },
  }
}

function candidate(
  ordinal: number,
  overrides: Partial<PresenterSource['candidates'][number]> = {},
): PresenterSource['candidates'][number] {
  return {
    id: `cand-${ordinal}`,
    runId: 'run-1',
    ordinal,
    quality: rubric([2, 2, 1, 2, 0]),
    qualityScore: 0.8,
    constraintEvaluations: [
      { constraintRef: 'c1', status: 'satisfied', rationale: 'r' },
    ],
    eligibility: 'ELIGIBLE',
    rejectionReasons: [],
    selectionState: 'NOT_SELECTED',
    selectionScore: null,
    displayPosition: null,
    content: {
      title: `Direction ${ordinal}`,
      distance: 'near',
      fitRationale: 'fit',
      strongestObjection: 'objection',
      firstTest: 'test',
    },
    ...overrides,
  }
}

function source(): PresenterSource {
  return {
    project: { originalPrompt: prompt },
    latestRun: {
      id: 'run-1',
      status: 'SUCCEEDED',
      modelProvider: 'anthropic',
      modelName: 'claude-sonnet-4-5',
      selectionPolicyVersion: 'initial-mmr-v3',
      rubricVersion: 'candidate-rubric-v2',
    },
    analysis: {
      facts: [
        {
          ref: 'f1',
          text: 'wants a bakery',
          evidenceText: 'I want a bakery',
          evidenceStart: 0,
          evidenceEnd: 15,
          strength: null,
        },
      ],
      constraints: [
        {
          ref: 'c1',
          text: 'No ads',
          evidenceText: 'No ads',
          evidenceStart: 17,
          evidenceEnd: 23,
          strength: 'hard',
        },
      ],
    },
    candidates: [
      candidate(3, {
        selectionState: 'SELECTED',
        selectionScore: 0.7,
        displayPosition: 2,
      }),
      candidate(1, {
        selectionState: 'SELECTED',
        selectionScore: 0.9,
        displayPosition: 1,
      }),
      candidate(2, {
        eligibility: 'REJECTED',
        selectionState: 'REJECTED',
        rejectionReasons: ['GENERIC_FIRST_TEST'],
        constraintEvaluations: [
          { constraintRef: 'c1', status: 'violated', rationale: 'r' },
        ],
      }),
      candidate(4, { selectionState: 'DUPLICATE' }),
      candidate(5),
      candidate(9, { runId: 'older-run', selectionState: 'SELECTED' }),
    ],
  }
}

describe('buildPresenterScript', () => {
  it('replays only the latest initial run, with selections in display order', () => {
    const script = buildPresenterScript(source())!
    expect(script.candidates.map((item) => item.ordinal)).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(script.selected.map((item) => item.ordinal)).toEqual([1, 3])
    expect(script.modelLabel).toBe('anthropic · claude-sonnet-4-5')
    expect(script.policyVersion).toBe('initial-mmr-v3')
  })

  it('marks fact and hard-constraint evidence spans in the original prompt', () => {
    const script = buildPresenterScript(source())!
    expect(script.segments).toEqual([
      { text: 'I want a bakery', kind: 'fact', ref: 'f1' },
      { text: '. ', kind: 'plain', ref: null },
      { text: 'No ads', kind: 'hard', ref: 'c1' },
      { text: '.', kind: 'plain', ref: null },
    ])
    expect(script.segments.map((segment) => segment.text).join('')).toBe(prompt)
  })

  it('maps rubric scores, constraint status and outcomes to visible stamps', () => {
    const script = buildPresenterScript(source())!
    const [first, rejected, , duplicate, notSelected] = script.candidates
    expect(first!.checks.map((check) => check.state)).toEqual([
      'ok',
      'ok',
      'mid',
      'ok',
      'bad',
      'ok',
    ])
    expect(rejected!.checks.at(-1)).toEqual({
      key: 'c1',
      label: 'c1',
      state: 'bad',
    })
    expect(rejected!.stamp).toBe('Generic first test')
    expect(duplicate!.stamp).toBe('Near duplicate')
    expect(notSelected!.stamp).toBe('Not selected')
    expect(first!.stamp).toBeNull()
  })

  it('supports legacy low/medium/high quality labels', () => {
    const input = source()
    input.candidates = input.candidates.map((item) => ({
      ...item,
      quality: {
        intentAlignment: { label: 'high', rationale: 'r' },
        usefulness: { label: 'medium', rationale: 'r' },
        specificity: { label: 'low', rationale: 'r' },
      },
    }))
    const script = buildPresenterScript(input)!
    expect(script.candidates[0]!.checks.map((check) => check.state)).toEqual([
      'ok',
      'mid',
      'bad',
      'ok',
    ])
  })

  it('returns null when the run did not succeed or nothing was selected', () => {
    const failed = source()
    failed.latestRun = { ...failed.latestRun!, status: 'FAILED' }
    expect(buildPresenterScript(failed)).toBeNull()
    const none = source()
    none.candidates = none.candidates.filter(
      (item) => item.selectionState !== 'SELECTED',
    )
    expect(buildPresenterScript(none)).toBeNull()
  })
})

describe('rejectionLabel', () => {
  it('humanizes rubric floor reasons', () => {
    expect(rejectionLabel('LOW_SCORE:firstTestExecutability')).toBe(
      'Low score · testable',
    )
    expect(rejectionLabel('HARD_CONSTRAINT_VIOLATED')).toBe(
      'Breaks a hard constraint',
    )
    expect(rejectionLabel('MISSING_FIELDS')).toBe('Missing fields')
  })
})
