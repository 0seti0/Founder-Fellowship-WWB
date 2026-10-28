import { type IdeaContent, type UnaryOperator } from '@unfold/shared'

export const OPERATOR_REGISTRY_VERSION = 'operators-v1'

export type ParentContext = {
  id: string
  type: 'ROOT_PROMPT' | 'IDEA'
  status: 'VISIBLE' | 'PINNED' | 'REJECTED' | 'ARCHIVED'
  operator: UnaryOperator | null
  content: Record<string, unknown>
}

export type PreconditionContext = {
  parents: ParentContext[]
  assumption?: string
}

export type PreconditionResult = {
  eligible: boolean
  code: string | null
  reason: string | null
  assumptions: string[]
}

export type PlanningFeatures = {
  depth: number
  ancestorOperators: UnaryOperator[]
  lastOperator: UnaryOperator | null
  projectOperatorCounts: Partial<Record<UnaryOperator, number>>
  operatorsAlreadyAppliedToParent: UnaryOperator[]
  pinnedCount: number
  parentPinned: boolean
  parentChildCount: number
  concreteAssumptionCount: number
  hasAbstractableMechanism: boolean
  distance: string | null
  timeHorizon: string | null
  risk: string | null
}

export type OperatorDefinition = {
  id: UnaryOperator
  label: string
  arity: 1
  description: string
  instruction: string
  exclusions: string[]
  precondition: (ctx: PreconditionContext) => PreconditionResult
  suitability: (features: PlanningFeatures) => {
    score: number
    breakdown: Record<string, number>
  }
  validateEffect: (candidate: IdeaContent, ctx: PreconditionContext) => string[]
}

const vagueTerms = /\b(?:unclear|unknown|tbd|n\/a|none|todo)\b/i

export function isConcreteAssumption(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  return words.length >= 4 && !vagueTerms.test(value)
}

export function availableAssumptions(parent: ParentContext) {
  const content = parent.content as Partial<IdeaContent>
  const assumptions = [
    ...(content.changedAssumptions ?? []),
    ...(content.hypothesis?.assumptions ?? []),
  ]
  const seen = new Set<string>()
  return assumptions.filter((assumption) => {
    const key = assumption.trim().toLowerCase()
    if (!isConcreteAssumption(assumption) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function result(
  eligible: boolean,
  code: string | null = null,
  reason: string | null = null,
  assumptions: string[] = [],
): PreconditionResult {
  return { eligible, code, reason, assumptions }
}

function commonPrecondition(ctx: PreconditionContext) {
  if (ctx.parents.length !== 1)
    return {
      failure: result(
        false,
        'INVALID_PARENT_COUNT',
        'Exactly one parent is required.',
      ),
    }
  const parent = ctx.parents[0]!
  if (parent.type !== 'IDEA')
    return {
      failure: result(
        false,
        'ROOT_NOT_EXPANDABLE',
        'The prompt itself cannot be transformed.',
      ),
    }
  if (parent.status === 'REJECTED')
    return {
      failure: result(
        false,
        'PARENT_REJECTED',
        'Rejected directions cannot be expanded.',
      ),
    }
  if (parent.status === 'ARCHIVED')
    return {
      failure: result(
        false,
        'PARENT_ARCHIVED',
        'Archived directions cannot be expanded.',
      ),
    }
  if (parent.status !== 'VISIBLE' && parent.status !== 'PINNED')
    return {
      failure: result(
        false,
        'PARENT_NOT_VISIBLE',
        'Only visible or pinned directions can be expanded.',
      ),
    }
  return { parent }
}

function baseSuitability(operator: UnaryOperator, features: PlanningFeatures) {
  const breakdown: Record<string, number> = { base: 0.5 }
  if (operator === 'GROUND') {
    if (features.distance !== 'near') breakdown.needsGrounding = 0.2
    if (features.timeHorizon === 'years') breakdown.longHorizon = 0.2
  }
  if (operator === 'LEAP') {
    if (features.distance === 'near') breakdown.nearParent = 0.1
    if (features.distance === 'leap') breakdown.leapParent = -0.2
    if (features.depth > 2) breakdown.depth = -0.1 * (features.depth - 2)
  }
  if (operator === 'INVERT')
    breakdown.assumptions = 0.05 * Math.min(3, features.concreteAssumptionCount)
  if (operator === 'TRANSPLANT' && features.hasAbstractableMechanism) {
    breakdown.abstractableMechanism = 0.1
    if (features.risk !== 'high') breakdown.risk = 0.1
  }
  if (operator === 'REFRAME') breakdown.reframe = 0.05
  if (features.lastOperator === operator) breakdown.immediateRepetition = -0.3
  if (features.operatorsAlreadyAppliedToParent.includes(operator))
    breakdown.appliedToParent = -0.1
  return {
    score: Math.min(
      1,
      Math.max(
        0,
        Object.values(breakdown).reduce((a, b) => a + b, 0),
      ),
    ),
    breakdown,
  }
}

function effects(
  operator: UnaryOperator,
  candidate: IdeaContent,
  ctx: PreconditionContext,
) {
  const errors: string[] = []
  if (operator === 'GROUND' && candidate.distance !== 'near')
    errors.push('GROUND_DISTANCE')
  if (
    operator === 'REFRAME' &&
    !['near', 'adjacent'].includes(candidate.distance)
  )
    errors.push('REFRAME_DISTANCE')
  if (operator === 'LEAP' && candidate.distance !== 'leap')
    errors.push('LEAP_DISTANCE')
  if (operator === 'INVERT' && candidate.invertedAssumption !== ctx.assumption)
    errors.push('INVERTED_ASSUMPTION')
  if (operator === 'TRANSPLANT') {
    const parent = ctx.parents[0]
    const parentContent = parent?.content as Partial<IdeaContent> | undefined
    const beneficiary = parentContent?.hypothesis?.axes?.beneficiary
    if (!candidate.targetContext) errors.push('TARGET_CONTEXT_REQUIRED')
    else if (
      beneficiary &&
      candidate.targetContext.trim().toLowerCase() ===
        beneficiary.trim().toLowerCase()
    )
      errors.push('TARGET_CONTEXT_UNCHANGED')
  }
  return errors
}

const operators: Record<UnaryOperator, OperatorDefinition> = {
  GROUND: {
    id: 'GROUND',
    label: 'Ground',
    arity: 1,
    description: 'Make this direction more concrete and testable.',
    instruction:
      'Make the parent smaller, immediate, and testable while preserving its intent.',
    exclusions: ['Do not broaden the scope.', 'Do not change the core intent.'],
    precondition: (ctx) => {
      const common = commonPrecondition(ctx)
      return common.failure ?? result(true)
    },
    suitability: (features) => baseSuitability('GROUND', features),
    validateEffect: (candidate, ctx) => effects('GROUND', candidate, ctx),
  },
  REFRAME: {
    id: 'REFRAME',
    label: 'Reframe',
    arity: 1,
    description: 'Change the beneficiary, mechanism, or success criterion.',
    instruction:
      'Change a meaningful framing while preserving the deeper intent.',
    exclusions: ['Do not merely reword the parent.'],
    precondition: (ctx) => commonPrecondition(ctx).failure ?? result(true),
    suitability: (features) => baseSuitability('REFRAME', features),
    validateEffect: (candidate, ctx) => effects('REFRAME', candidate, ctx),
  },
  LEAP: {
    id: 'LEAP',
    label: 'Leap',
    arity: 1,
    description:
      'Explore a non-obvious jump that preserves the underlying intent.',
    instruction:
      'Make a larger semantic jump while explicitly preserving the underlying intent.',
    exclusions: ['Do not add random novelty.'],
    precondition: (ctx) => commonPrecondition(ctx).failure ?? result(true),
    suitability: (features) => baseSuitability('LEAP', features),
    validateEffect: (candidate, ctx) => effects('LEAP', candidate, ctx),
  },
  INVERT: {
    id: 'INVERT',
    label: 'Invert',
    arity: 1,
    description: 'Challenge a concrete assumption.',
    instruction:
      'Reverse the named assumption and explore a useful consequence.',
    exclusions: ['Do not invent the assumption.'],
    precondition: (ctx) => {
      const common = commonPrecondition(ctx)
      if (common.failure) return common.failure
      const assumptions = availableAssumptions(common.parent!)
      if (!assumptions.length)
        return result(
          false,
          'NO_CONCRETE_ASSUMPTION',
          "This direction doesn't state a concrete assumption to invert.",
        )
      if (ctx.assumption && !assumptions.includes(ctx.assumption))
        return result(
          false,
          'ASSUMPTION_NOT_FOUND',
          'The requested assumption is not available from this direction.',
          assumptions,
        )
      return result(true, null, null, assumptions)
    },
    suitability: (features) => baseSuitability('INVERT', features),
    validateEffect: (candidate, ctx) => effects('INVERT', candidate, ctx),
  },
  TRANSPLANT: {
    id: 'TRANSPLANT',
    label: 'Transplant',
    arity: 1,
    description: 'Apply the abstracted mechanism in a different context.',
    instruction:
      'Abstract the mechanism and apply it in a meaningfully different context.',
    exclusions: ['Do not keep the original beneficiary context.'],
    precondition: (ctx) => {
      const common = commonPrecondition(ctx)
      if (common.failure) return common.failure
      const mechanism = String(common.parent!.content.mechanism ?? '').trim()
      if (
        mechanism.split(/\s+/).filter(Boolean).length < 2 ||
        vagueTerms.test(mechanism)
      )
        return result(
          false,
          'NO_ABSTRACTABLE_MECHANISM',
          'This direction has no concrete mechanism to transplant.',
        )
      return result(true)
    },
    suitability: (features) => baseSuitability('TRANSPLANT', features),
    validateEffect: (candidate, ctx) => effects('TRANSPLANT', candidate, ctx),
  },
}

export const OPERATOR_REGISTRY = operators

export function getOperatorOptions(
  ctx: PreconditionContext,
  featuresFor: (operator: UnaryOperator) => PlanningFeatures,
) {
  const options = Object.values(operators).map((definition) => {
    const precondition = definition.precondition(ctx)
    const suitability = definition.suitability(featuresFor(definition.id))
    return {
      operator: definition.id,
      label: definition.label,
      description: definition.description,
      eligible: precondition.eligible,
      code: precondition.code,
      reason: precondition.reason,
      suitability: suitability.score,
      suggested: false,
      assumptions: definition.id === 'INVERT' ? precondition.assumptions : [],
    }
  })
  const suggested = options
    .filter((option) => option.eligible)
    .sort((left, right) => right.suitability - left.suitability)[0]
  if (suggested) suggested.suggested = true
  return options
}
