import { describe, expect, it } from 'vitest'
import {
  OPERATOR_REGISTRY,
  OPERATOR_REGISTRY_VERSION,
  availableAssumptions,
  type ParentContext,
} from '../src/operators/registry'
import { computePlanningFeatures, suitability } from '../src/operators/planning'

const parent = {
  id: 'idea',
  type: 'IDEA' as const,
  status: 'VISIBLE' as const,
  operator: null,
  content: {
    distance: 'near',
    mechanism: 'A repeatable sample process',
    changedAssumptions: ['Nearby families can purchase samples weekly.'],
    hypothesis: {
      axes: {
        beneficiary: 'families',
        timeHorizon: 'months',
        risk: 'low',
      },
      assumptions: ['Neighbors want a welcoming place to meet.'],
    },
  },
  createdAt: '2025-01-01T00:00:00.000Z',
}

describe('operator registry and planning', () => {
  it('registers exactly five unary operators and excludes steering actions', () => {
    expect(OPERATOR_REGISTRY_VERSION).toBe('operators-v1')
    expect(Object.keys(OPERATOR_REGISTRY)).toEqual([
      'GROUND',
      'REFRAME',
      'LEAP',
      'INVERT',
      'TRANSPLANT',
    ])
    expect(
      Object.values(OPERATOR_REGISTRY).every(({ arity }) => arity === 1),
    ).toBe(true)
  })

  it('checks common and operator-specific preconditions', () => {
    const call = (
      operator: keyof typeof OPERATOR_REGISTRY,
      value: ParentContext = parent,
    ) => OPERATOR_REGISTRY[operator].precondition({ parents: [value] })
    expect(call('GROUND').eligible).toBe(true)
    expect(call('GROUND', { ...parent, type: 'ROOT_PROMPT' }).code).toBe(
      'ROOT_NOT_EXPANDABLE',
    )
    expect(call('GROUND', { ...parent, status: 'REJECTED' }).code).toBe(
      'PARENT_REJECTED',
    )
    expect(call('GROUND', { ...parent, status: 'ARCHIVED' }).code).toBe(
      'PARENT_ARCHIVED',
    )
    expect(
      OPERATOR_REGISTRY.GROUND.precondition({ parents: [parent, parent] }).code,
    ).toBe('INVALID_PARENT_COUNT')
    expect(
      OPERATOR_REGISTRY.INVERT.precondition({
        parents: [{ ...parent, content: {} }],
      }).code,
    ).toBe('NO_CONCRETE_ASSUMPTION')
    expect(
      OPERATOR_REGISTRY.TRANSPLANT.precondition({
        parents: [{ ...parent, content: { mechanism: 'TBD' } }],
      }).code,
    ).toBe('NO_ABSTRACTABLE_MECHANISM')
    expect(
      OPERATOR_REGISTRY.INVERT.precondition({
        parents: [parent],
        assumption: 'not available',
      }).code,
    ).toBe('ASSUMPTION_NOT_FOUND')
    expect(availableAssumptions(parent)).toHaveLength(2)
    expect(
      Object.values(OPERATOR_REGISTRY).every(
        (operator) => operator.exclusions.length > 0,
      ),
    ).toBe(true)
  })

  it('computes planning features from graph rows and penalizes repetition', () => {
    const features = computePlanningFeatures(
      {
        nodes: [parent, { ...parent, id: 'root', type: 'ROOT_PROMPT' }],
        edges: [
          {
            id: 'e',
            parentId: 'root',
            childId: 'idea',
            createdAt: parent.createdAt,
          },
        ],
      },
      parent.id,
    )
    expect(features.depth).toBe(1)
    expect(features.concreteAssumptionCount).toBe(2)
    const repeated = suitability('GROUND', {
      ...features,
      lastOperator: 'GROUND',
    })
    const fresh = suitability('GROUND', { ...features, lastOperator: null })
    expect(repeated.breakdown.immediateRepetition).toBe(-0.3)
    expect(repeated.score).toBeLessThan(fresh.score)
    expect(suitability('GROUND', features)).toEqual(
      suitability('GROUND', features),
    )
  })
})
