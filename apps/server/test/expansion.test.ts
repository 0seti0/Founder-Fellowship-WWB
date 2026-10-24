import { describe, expect, it } from 'vitest'
import {
  IdeaContentSchema,
  type ExtractedFact,
  type IdeaContent,
  type UnaryOperator,
} from '@unfold/shared'
import {
  expandPipeline,
  generatePipeline,
  PipelineError,
} from '../src/generation/pipeline'
import { OPERATOR_REGISTRY } from '../src/operators/registry'
import { createModelProvider, embedText } from '../src/model/provider'

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
    expect(
      selectedFew.length,
      JSON.stringify(
        fewPass.candidates.map(
          ({ ordinal, eligibility, rejectionReasons }) => ({
            ordinal,
            eligibility,
            rejectionReasons,
          }),
        ),
      ),
    ).toBeGreaterThan(0)
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

  it('keeps all five fixture families below the embedding dedup threshold', async () => {
    const { parent, facts } = await expansionContext()
    const operators = [
      'GROUND',
      'REFRAME',
      'LEAP',
      'INVERT',
      'TRANSPLANT',
    ] as const
    const byOperator = new Map<UnaryOperator, IdeaContent[]>()
    for (const operator of operators) {
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
      byOperator.set(
        operator,
        result.candidates.map((candidate) => candidate.content),
      )
    }
    const text = (idea: IdeaContent) =>
      [idea.title, idea.summary, idea.mechanism].join(' ')
    const parentVector = embedText(text(parent))
    const vectors = new Map(
      [...byOperator].map(([operator, ideas]) => [
        operator,
        ideas.map((idea) => embedText(text(idea))),
      ]),
    )
    for (const operator of operators) {
      for (const vector of vectors.get(operator)!) {
        expect(cosine(vector, parentVector)).toBeLessThan(0.92)
      }
    }
    for (let left = 0; left < operators.length; left += 1) {
      for (let right = left + 1; right < operators.length; right += 1) {
        for (const leftVector of vectors.get(operators[left]!)!) {
          for (const rightVector of vectors.get(operators[right]!)!) {
            expect(cosine(leftVector, rightVector)).toBeLessThan(0.92)
          }
        }
      }
    }
  })

  it('rejects effect failures per candidate without retrying the expansion', async () => {
    const { parent, facts } = await expansionContext()
    const provider = createModelProvider({ MODEL_MODE: 'mock' })
    const generate = provider.generateStructured.bind(provider)
    provider.generateStructured = async (request) => {
      const output = await generate(request)
      if (request.task !== 'expand') return output
      const expanded = output as {
        operator: UnaryOperator
        candidates: IdeaContent[]
      }
      return {
        ...expanded,
        candidates: expanded.candidates.map((candidate, index) =>
          index === 0 ? { ...candidate, distance: 'leap' } : candidate,
        ),
      }
    }
    const result = await expandPipeline({
      operator: 'GROUND',
      parent,
      rootPrompt: prompt,
      facts,
      constraints: [],
      provider,
      timeoutMs,
    })
    expect(
      result.attempts.filter((attempt) => attempt.task === 'expand'),
    ).toHaveLength(1)
    expect(result.candidates[0]?.rejectionReasons).toContain(
      'OPERATOR_EFFECT:GROUND_DISTANCE',
    )
    expect(result.candidates[0]?.selectionState).toBe('REJECTED')
    expect(
      result.candidates.some(
        (candidate) => candidate.selectionState === 'SELECTED',
      ),
    ).toBe(true)
  })

  it.each(['duplicate-key', 'invalid-fact-ref'] as const)(
    'retries malformed expansion %s with MALFORMED_OUTPUT',
    async (fault) => {
      const { parent, facts } = await expansionContext()
      const provider = createModelProvider({ MODEL_MODE: 'mock' })
      const generate = provider.generateStructured.bind(provider)
      provider.generateStructured = async (request) => {
        const output = await generate(request)
        if (request.task !== 'expand') return output
        const expanded = output as {
          operator: UnaryOperator
          candidates: IdeaContent[]
        }
        return {
          ...expanded,
          candidates: expanded.candidates.map((candidate, index) =>
            fault === 'duplicate-key' && index === 1
              ? { ...candidate, key: expanded.candidates[0]!.key }
              : fault === 'invalid-fact-ref' && index === 0
                ? {
                    ...candidate,
                    hypothesis: {
                      ...candidate.hypothesis,
                      supportingFactRefs: ['missing-fact'],
                    },
                  }
                : candidate,
          ),
        }
      }
      await expect(
        expandPipeline({
          operator: 'GROUND',
          parent,
          rootPrompt: prompt,
          facts,
          constraints: [],
          provider,
          timeoutMs,
        }),
      ).rejects.toMatchObject({
        code: 'MALFORMED_OUTPUT',
        attempts: expect.arrayContaining([
          expect.objectContaining({
            task: 'expand',
            attempt: 1,
            ok: false,
            code: 'MALFORMED_OUTPUT',
          }),
          expect.objectContaining({
            task: 'expand',
            attempt: 2,
            ok: false,
            code: 'MALFORMED_OUTPUT',
          }),
        ]),
      })
    },
  )

  it('deduplicates existing children before selection and frees the slot', async () => {
    const { parent, facts } = await expansionContext()
    const options = {
      operator: 'GROUND' as const,
      parent,
      rootPrompt: prompt,
      facts,
      constraints: [],
      provider: createModelProvider({ MODEL_MODE: 'mock' }),
      timeoutMs,
    }
    const baseline = await expandPipeline(options)
    const duplicate = baseline.candidates.find(
      (candidate) => candidate.selectionState === 'SELECTED',
    )!
    const result = await expandPipeline({
      ...options,
      provider: createModelProvider({ MODEL_MODE: 'mock' }),
      existingChildren: [
        {
          id: 'existing-child',
          title: duplicate.content.title,
          summary: duplicate.content.summary,
          mechanism: duplicate.content.mechanism,
        },
      ],
    })
    expect(
      result.candidates.find(
        (candidate) => candidate.content.key === duplicate.content.key,
      ),
    ).toMatchObject({
      selectionState: 'DUPLICATE',
      selectionMetadata: { duplicateOfNodeId: 'existing-child' },
    })
    expect(
      result.candidates.filter(
        (candidate) => candidate.selectionState === 'SELECTED',
      ),
    ).toHaveLength(
      baseline.candidates.filter(
        (candidate) => candidate.selectionState === 'SELECTED',
      ).length,
    )
    for (const candidate of result.candidates.filter(
      (item) => item.selectionState === 'SELECTED',
    )) {
      const components = candidate.selectionMetadata.components as
        Record<string, unknown> | undefined
      expect(typeof components?.axisCoverageBonus).toBe('number')
      expect(components!.axisCoverageBonus as number).toBeGreaterThanOrEqual(0)
      expect(components!.axisCoverageBonus as number).toBeLessThanOrEqual(0.04)
    }
  })

  it('uses text-fallback similarity for existing children when embeddings degrade', async () => {
    const { parent, facts } = await expansionContext()
    const baseline = await expandPipeline({
      operator: 'GROUND',
      parent,
      rootPrompt: prompt,
      facts,
      constraints: [],
      provider: createModelProvider({ MODEL_MODE: 'mock' }),
      timeoutMs,
    })
    const duplicate = baseline.candidates.find(
      (candidate) => candidate.selectionState === 'SELECTED',
    )!
    const result = await expandPipeline({
      operator: 'GROUND',
      parent,
      rootPrompt: prompt,
      facts,
      constraints: [],
      provider: createModelProvider(
        { MODEL_MODE: 'mock' },
        { mockScenario: 'embedding-failure' },
      ),
      existingChildren: [
        {
          id: 'existing-child',
          title: duplicate.content.title,
          summary: duplicate.content.summary,
          mechanism: duplicate.content.mechanism,
        },
      ],
      timeoutMs,
    })
    expect(result.dedupMode).toBe('TEXT_FALLBACK')
    expect(
      result.candidates.find(
        (candidate) => candidate.content.key === duplicate.content.key,
      ),
    ).toMatchObject({
      selectionState: 'DUPLICATE',
      selectionMetadata: { duplicateOfNodeId: 'existing-child' },
    })
  })
})

function cosine(left: number[], right: number[]) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index]!, 0)
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value ** 2, 0))
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value ** 2, 0))
  return leftNorm && rightNorm ? dot / (leftNorm * rightNorm) : 0
}
