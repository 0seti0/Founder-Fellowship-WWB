import { describe, expect, it } from 'vitest'
import {
  IdeaContentSchema,
  type ExtractedFact,
  type UnaryOperator,
} from '@unfold/shared'
import {
  expandPipeline,
  generatePipeline,
  PipelineError,
} from '../src/generation/pipeline'
import { OPERATOR_REGISTRY } from '../src/operators/registry'
import { createModelProvider } from '../src/model/provider'

const prompt = 'I want to open a bakery for neighbors.'
const timeoutMs = 100

async function expansionContext() {
  const initial = await generatePipeline({
    prompt,
    provider: createModelProvider({ MODEL_MODE: 'mock' }),
    timeoutMs,
  })
  return {
    parent: IdeaContentSchema.parse(initial.candidates[0]!.content),
    facts: initial.facts.map((span) => span.item as ExtractedFact),
  }
}

async function expand(
  operator: UnaryOperator,
  scenario?:
    | 'malformed-once'
    | 'operator-mismatch'
    | 'provider-error'
    | 'few-pass'
    | 'none-pass'
    | 'weak-diverse',
) {
  const { parent, facts } = await expansionContext()
  return expandPipeline({
    operator,
    parent,
    rootPrompt: prompt,
    facts,
    constraints: [],
    assumption: parent.changedAssumptions[0],
    mechanism: parent.mechanism,
    provider: createModelProvider(
      { MODEL_MODE: 'mock' },
      { mockScenario: scenario },
    ),
    timeoutMs,
  })
}

describe('operator expansion pipeline', () => {
  it.each(['GROUND', 'REFRAME', 'LEAP', 'INVERT', 'TRANSPLANT'] as const)(
    'validates %s output and its operator effect',
    async (operator) => {
      const { parent, facts } = await expansionContext()
      const result = await expandPipeline({
        operator,
        parent,
        rootPrompt: prompt,
        facts,
        constraints: [],
        assumption: parent.changedAssumptions[0],
        mechanism: parent.mechanism,
        provider: createModelProvider({ MODEL_MODE: 'mock' }),
        timeoutMs,
      })
      const selected = result.candidates.filter(
        (candidate) => candidate.selectionState === 'SELECTED',
      )
      expect(selected.length).toBeGreaterThanOrEqual(1)
      expect(selected.length).toBeLessThanOrEqual(3)
      expect(result.candidates).toHaveLength(6)
      for (const candidate of selected) {
        expect(
          OPERATOR_REGISTRY[operator].validateEffect(candidate.content, {
            parents: [
              {
                id: 'parent',
                type: 'IDEA',
                status: 'VISIBLE',
                operator: null,
                content: parent,
              },
            ],
            assumption: parent.changedAssumptions[0],
          }),
        ).toEqual([])
      }
    },
  )

  it('retries malformed output once and then succeeds', async () => {
    const result = await expand('GROUND', 'malformed-once')
    expect(
      result.attempts.filter((attempt) => attempt.task === 'expand'),
    ).toHaveLength(2)
    expect(
      result.candidates.some(
        (candidate) => candidate.selectionState === 'SELECTED',
      ),
    ).toBe(true)
  })

  it('retries an operator mismatch once before failing', async () => {
    await expect(expand('GROUND', 'operator-mismatch')).rejects.toMatchObject({
      code: 'OPERATOR_MISMATCH',
      attempts: expect.arrayContaining([
        expect.objectContaining({ task: 'expand', attempt: 1, ok: false }),
        expect.objectContaining({ task: 'expand', attempt: 2, ok: false }),
      ]),
    } satisfies Partial<PipelineError>)
  })

  it('does not convert a provider error into a successful expansion', async () => {
    await expect(expand('GROUND', 'provider-error')).rejects.toBeInstanceOf(
      PipelineError,
    )
  })

  it('caps display at three and permits fewer or zero quality-passing results', async () => {
    const fewPass = await expand('GROUND', 'few-pass')
    const selectedFew = fewPass.candidates.filter(
      (candidate) => candidate.selectionState === 'SELECTED',
    )
    expect(selectedFew.length).toBeGreaterThan(0)
    expect(selectedFew.length).toBeLessThanOrEqual(3)

    const nonePass = await expand('GROUND', 'none-pass')
    expect(
      nonePass.candidates.filter(
        (candidate) => candidate.selectionState === 'SELECTED',
      ),
    ).toHaveLength(0)
  })

  it('does not select a weak-diverse LEAP candidate', async () => {
    const result = await expand('LEAP', 'weak-diverse')
    expect(result.candidates[5]?.eligibility).toBe('REJECTED')
    expect(result.candidates[5]?.selectionState).toBe('REJECTED')
  })
})
