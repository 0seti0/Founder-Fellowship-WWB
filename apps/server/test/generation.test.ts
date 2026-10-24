import { describe, expect, it } from 'vitest'
import type { FrameCandidate, MockScenario } from '@unfold/shared'
import { createModelProvider, type ModelProvider } from '../src/model/provider'
import { generatePipeline, PipelineError } from '../src/generation/pipeline'

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
    const displayed = result.candidates.filter(
      (candidate) => candidate.selectionState === 'SELECTED',
    )
    const contactTerms =
      /\b(?:contact|interview|ask|invite|survey|call|email|message|talk|meet|reach(?:\s+out)?)(?:s|ed|ing)?\b/i
    const candidateText = (candidate: (typeof result.candidates)[number]) =>
      [
        candidate.content.title,
        candidate.content.summary,
        candidate.content.mechanism,
        candidate.content.firstTest,
      ].join(' ')

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
        'HARD_CONSTRAINT_VIOLATED:c1',
      )
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
      policyVersion: 'initial-mmr-v1',
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
