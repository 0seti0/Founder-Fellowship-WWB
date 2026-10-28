import { describe, expect, it } from 'vitest'
import type { FrameCandidate } from '@unfold/shared'
import { createModelProvider, type ModelProvider } from '../src/model/provider'
import { compareCandidates } from '../src/generation/functionalEquivalence'
import { PipelineError } from '../src/generation/pipeline'
import { FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT } from '../src/generation/prompts'

const candidate: FrameCandidate = {
  key: 'direction',
  title: 'Test a neighborhood bread box',
  summary: 'Offer a weekly bread box to nearby residents.',
  hypothesis: {
    statement: 'Nearby families may value a reliable bread pickup.',
    assumptions: ['Families want a weekly pickup.'],
    supportingFactRefs: [],
    counterevidence: [],
    falsifiers: ['No families sign up.'],
  },
  preservedIntent: 'Explore a neighborhood bakery.',
  changedAssumptions: ['Start with a weekly order.'],
  fitRationale: 'A small order test reveals demand.',
  strongestObjection: 'Interest may be seasonal.',
  firstTest: 'Ask six nearby families to preorder a bread box this week.',
  mechanism: 'Weekly preorder and pickup.',
  distance: 'near',
}

const input = {
  originalPrompt: 'I want to open a bakery for neighbors.',
  left: candidate,
  right: { ...candidate, key: 'other' },
  constraints: [],
  timeoutMs: 100,
}

function providerWith(
  generateStructured: ModelProvider['generateStructured'],
): ModelProvider {
  const mock = createModelProvider({ MODEL_MODE: 'mock' })
  return {
    identity: mock.identity,
    generateStructured,
    embed: (texts, signal) => mock.embed(texts, signal),
  }
}

describe('functional-equivalence comparison', () => {
  it('compares only prompt context, constraints, and candidate content', async () => {
    const mock = createModelProvider({ MODEL_MODE: 'mock' })
    let request: Parameters<ModelProvider['generateStructured']>[0] | undefined
    const provider = providerWith(async (nextRequest) => {
      request = nextRequest
      return mock.generateStructured(nextRequest)
    })
    const result = await compareCandidates(provider, input)
    expect(result.verdict).toBe('equivalent')
    expect(result.attempts).toEqual([{ task: 'compare', attempt: 1, ok: true }])
    expect(request).toMatchObject({
      task: 'compare',
      promptVersion: 'functional-equivalence-v1',
      system: FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT,
      input: {
        originalPrompt: input.originalPrompt,
        constraints: [],
        left: candidate,
        right: input.right,
      },
    })
    expect(Object.keys(request!.input as object).sort()).toEqual([
      'constraints',
      'left',
      'originalPrompt',
      'right',
    ])
  })

  it('repairs malformed output once and records both attempts', async () => {
    const mock = createModelProvider({ MODEL_MODE: 'mock' })
    let call = 0
    const result = await compareCandidates(
      providerWith(async (request) => {
        call += 1
        if (call === 1) return { verdict: 'same', rationale: '' }
        return mock.generateStructured(request)
      }),
      input,
    )
    expect(call).toBe(2)
    expect(result.attempts).toEqual([
      expect.objectContaining({
        task: 'compare',
        attempt: 1,
        ok: false,
        code: 'MALFORMED_OUTPUT',
      }),
      { task: 'compare', attempt: 2, ok: true },
    ])
  })

  it('fails after two malformed outputs', async () => {
    await expect(
      compareCandidates(
        providerWith(async () => ({ verdict: 'same', rationale: '' })),
        input,
      ),
    ).rejects.toMatchObject({
      code: 'MALFORMED_OUTPUT',
      attempts: expect.arrayContaining([
        expect.objectContaining({ task: 'compare', attempt: 2, ok: false }),
      ]),
    } satisfies Partial<PipelineError>)
  })
})
