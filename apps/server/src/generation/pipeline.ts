import {
  EvaluateOutputSchema,
  ExtractionOutputSchema,
  FrameOutputSchema,
  type CandidateEvaluation,
  type ExtractedConstraint,
  type ExtractedFact,
  type FrameCandidate,
} from '@unfold/shared'
import { randomUUID } from 'node:crypto'
import {
  EVALUATE_PROMPT_VERSION,
  EVALUATE_SYSTEM_PROMPT,
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SYSTEM_PROMPT,
  FRAME_PROMPT_VERSION,
  FRAME_SYSTEM_PROMPT,
} from './prompts'
import {
  ProviderError,
  type ModelProvider,
  type StructuredGenerationRequest,
} from '../model/provider'

export const SCHEMA_VERSION = 'stage1-v1'
export const SELECTION_POLICY_VERSION = 'initial-mmr-v1'

export type PipelineAttempt = {
  task: 'extract' | 'frame' | 'evaluate' | 'dedupe' | 'selection'
  attempt?: number
  ok: boolean
  code?: string
  message?: string
  reason?: string
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly attempts: PipelineAttempt[],
  ) {
    super(message)
    this.name = 'PipelineError'
  }
}

export type EvidenceSpan = {
  id: string
  item: ExtractedFact | ExtractedConstraint
  start: number
  end: number
}

export type ScoredCandidate = {
  id: string
  ordinal: number
  content: FrameCandidate
  evaluation: CandidateEvaluation
  qualityScore: number
  completeness: Record<string, boolean>
  genericFirstTest: boolean
  eligibility: 'ELIGIBLE' | 'REJECTED'
  rejectionReasons: string[]
  selectionState: 'SELECTED' | 'NOT_SELECTED' | 'REJECTED' | 'DUPLICATE'
  duplicateOfCandidateId: string | null
  dedupSimilarity: number | null
  selectionScore: number | null
  selectionProbability: number
  selectionMetadata: Record<string, unknown>
  displayPosition: number | null
  hypothesisSupportingFactIds: string[]
}

export type PipelineResult = {
  facts: EvidenceSpan[]
  constraints: EvidenceSpan[]
  candidates: ScoredCandidate[]
  attempts: PipelineAttempt[]
  dedupMode: 'EMBEDDING' | 'TEXT_FALLBACK'
  degraded: boolean
  degradationReason: string | null
}

type PipelineOptions = {
  prompt: string
  provider: ModelProvider
  timeoutMs: number
}

const promptVersions = {
  extract: EXTRACT_PROMPT_VERSION,
  frame: FRAME_PROMPT_VERSION,
  evaluate: EVALUATE_PROMPT_VERSION,
}

export async function generatePipeline({
  prompt,
  provider,
  timeoutMs,
}: PipelineOptions): Promise<PipelineResult> {
  const attempts: PipelineAttempt[] = []
  const extracted = await extract(prompt, provider, timeoutMs, attempts)
  const frameCandidates = await frame(
    prompt,
    extracted.facts.map((span) => span.item as ExtractedFact),
    extracted.constraints.map((span) => span.item as ExtractedConstraint),
    provider,
    timeoutMs,
    attempts,
  )
  const evaluations = await evaluate(
    frameCandidates,
    extracted.constraints.map((span) => span.item as ExtractedConstraint),
    provider,
    timeoutMs,
    attempts,
  )
  return completePipeline({
    facts: extracted.facts,
    constraints: extracted.constraints,
    frameCandidates,
    evaluations,
    provider,
    timeoutMs,
    attempts,
  })
}

async function extract(
  prompt: string,
  provider: ModelProvider,
  timeoutMs: number,
  attempts: PipelineAttempt[],
): Promise<{ facts: EvidenceSpan[]; constraints: EvidenceSpan[] }> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await invoke(
      provider,
      {
        task: 'extract',
        promptVersion: promptVersions.extract,
        schemaVersion: SCHEMA_VERSION,
        system: EXTRACT_SYSTEM_PROMPT,
        input: { prompt },
      },
      timeoutMs,
      attempts,
      attempt,
    )
    const parsed = ExtractionOutputSchema.safeParse(result)
    if (!parsed.success) {
      attempts.push({
        task: 'extract',
        attempt,
        ok: false,
        code: 'MALFORMED_OUTPUT',
        message: parsed.error.message,
      })
      if (attempt === 2)
        throw new PipelineError(
          'Extraction output did not match the required schema',
          'MALFORMED_OUTPUT',
          attempts,
        )
      continue
    }

    const facts: EvidenceSpan[] = []
    const constraints: EvidenceSpan[] = []
    let invalidEvidence = false
    for (const item of [...parsed.data.facts, ...parsed.data.constraints]) {
      const start = prompt.indexOf(item.evidence)
      if (start < 0) {
        invalidEvidence = true
        break
      }
      const span = {
        id: randomUUID(),
        item,
        start,
        end: start + item.evidence.length,
      }
      if (item.ref.startsWith('f')) facts.push(span)
      else constraints.push(span)
    }
    if (invalidEvidence) {
      attempts.push({
        task: 'extract',
        attempt,
        ok: false,
        code: 'INVALID_EVIDENCE',
        message: 'Evidence must be an exact substring of the original prompt',
      })
      if (attempt === 2)
        throw new PipelineError(
          'Extraction included evidence not contained in the prompt',
          'INVALID_EVIDENCE',
          attempts,
        )
      continue
    }
    attempts.push({ task: 'extract', attempt, ok: true })
    return { facts, constraints }
  }
  throw new PipelineError('Extraction failed', 'MALFORMED_OUTPUT', attempts)
}

async function frame(
  prompt: string,
  facts: ExtractedFact[],
  constraints: ExtractedConstraint[],
  provider: ModelProvider,
  timeoutMs: number,
  attempts: PipelineAttempt[],
): Promise<FrameCandidate[]> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await invoke(
      provider,
      {
        task: 'frame',
        promptVersion: promptVersions.frame,
        schemaVersion: SCHEMA_VERSION,
        system: FRAME_SYSTEM_PROMPT,
        input: { prompt, facts, constraints },
      },
      timeoutMs,
      attempts,
      attempt,
    )
    const parsed = FrameOutputSchema.safeParse(result)
    if (!parsed.success) {
      attempts.push({
        task: 'frame',
        attempt,
        ok: false,
        code: 'MALFORMED_OUTPUT',
        message: parsed.error.message,
      })
      if (attempt === 2)
        throw new PipelineError(
          'Frame output did not match the required schema',
          'MALFORMED_OUTPUT',
          attempts,
        )
      continue
    }

    const factRefs = new Set(facts.map((fact) => fact.ref))
    const validRefs = parsed.data.candidates.every((candidate) =>
      candidate.hypothesis.supportingFactRefs.every((ref) => factRefs.has(ref)),
    )
    const uniqueKeys =
      new Set(parsed.data.candidates.map((candidate) => candidate.key)).size ===
      parsed.data.candidates.length
    if (!validRefs || !uniqueKeys) {
      attempts.push({
        task: 'frame',
        attempt,
        ok: false,
        code: 'MALFORMED_OUTPUT',
        message: validRefs
          ? 'Candidate keys must be unique'
          : 'A candidate cited a missing supporting fact',
      })
      if (attempt === 2)
        throw new PipelineError(
          'Frame candidates referenced missing facts or repeated keys',
          'MALFORMED_OUTPUT',
          attempts,
        )
      continue
    }

    if (!hasContrastiveVariation(parsed.data.candidates)) {
      attempts.push({
        task: 'frame',
        attempt,
        ok: false,
        code: 'PARAPHRASE_SET',
        message: 'Frame candidates did not vary across at least two axes',
      })
      if (attempt === 2)
        throw new PipelineError(
          'Frame candidates were paraphrases rather than distinct directions',
          'PARAPHRASE_SET',
          attempts,
        )
      continue
    }
    attempts.push({ task: 'frame', attempt, ok: true })
    return parsed.data.candidates
  }
  throw new PipelineError(
    'Frame generation failed',
    'MALFORMED_OUTPUT',
    attempts,
  )
}

async function evaluate(
  candidates: FrameCandidate[],
  constraints: ExtractedConstraint[],
  provider: ModelProvider,
  timeoutMs: number,
  attempts: PipelineAttempt[],
): Promise<CandidateEvaluation[]> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await invoke(
      provider,
      {
        task: 'evaluate',
        promptVersion: promptVersions.evaluate,
        schemaVersion: SCHEMA_VERSION,
        system: EVALUATE_SYSTEM_PROMPT,
        input: { candidates, constraints },
      },
      timeoutMs,
      attempts,
      attempt,
    )
    const parsed = EvaluateOutputSchema.safeParse(result)
    const coverageError = parsed.success
      ? evaluationCoverageError(
          parsed.data.evaluations,
          candidates,
          constraints,
        )
      : null
    if (!parsed.success || coverageError) {
      attempts.push({
        task: 'evaluate',
        attempt,
        ok: false,
        code: 'MALFORMED_OUTPUT',
        message: parsed.success ? coverageError! : parsed.error.message,
      })
      if (attempt === 2)
        throw new PipelineError(
          'Evaluation did not cover every candidate and constraint',
          'MALFORMED_OUTPUT',
          attempts,
        )
      continue
    }
    attempts.push({ task: 'evaluate', attempt, ok: true })
    return parsed.data.evaluations
  }
  throw new PipelineError('Evaluation failed', 'MALFORMED_OUTPUT', attempts)
}

function evaluationCoverageError(
  evaluations: CandidateEvaluation[],
  candidates: FrameCandidate[],
  constraints: ExtractedConstraint[],
) {
  if (evaluations.length !== candidates.length)
    return 'Evaluation must include every candidate exactly once'
  const expectedCandidateKeys = new Set(
    candidates.map((candidate) => candidate.key),
  )
  const seenCandidateKeys = new Set<string>()
  const expectedConstraintRefs = new Set(
    constraints.map((constraint) => constraint.ref),
  )
  for (const evaluation of evaluations) {
    if (
      !expectedCandidateKeys.has(evaluation.candidateKey) ||
      seenCandidateKeys.has(evaluation.candidateKey)
    )
      return 'Evaluation candidate keys must match the frame set exactly'
    seenCandidateKeys.add(evaluation.candidateKey)
    if (evaluation.constraints.length !== constraints.length)
      return 'Evaluation must cover every constraint exactly once'
    const seenConstraintRefs = new Set<string>()
    for (const evaluationItem of evaluation.constraints) {
      if (
        !expectedConstraintRefs.has(evaluationItem.constraintRef) ||
        seenConstraintRefs.has(evaluationItem.constraintRef)
      )
        return 'Evaluation constraint references must match exactly'
      seenConstraintRefs.add(evaluationItem.constraintRef)
    }
  }
  return null
}

function hasContrastiveVariation(candidates: FrameCandidate[]) {
  const axes = [
    'goal',
    'beneficiary',
    'motivation',
    'mechanism',
    'timeHorizon',
    'risk',
  ] as const
  const variedAxisCount = axes.filter(
    (axis) =>
      new Set(
        candidates.map((candidate) =>
          normalize(candidate.hypothesis.axes[axis]),
        ),
      ).size > 1,
  ).length
  if (variedAxisCount < 2) return false
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const differences = axes.filter(
        (axis) =>
          normalize(candidates[left]!.hypothesis.axes[axis]) !==
          normalize(candidates[right]!.hypothesis.axes[axis]),
      ).length
      if (differences < 2) return false
    }
  }
  return true
}

async function completePipeline({
  facts,
  constraints,
  frameCandidates,
  evaluations,
  provider,
  timeoutMs,
  attempts,
}: {
  facts: EvidenceSpan[]
  constraints: EvidenceSpan[]
  frameCandidates: FrameCandidate[]
  evaluations: CandidateEvaluation[]
  provider: ModelProvider
  timeoutMs: number
  attempts: PipelineAttempt[]
}): Promise<PipelineResult> {
  const promptFactIds = new Map<string, string>()
  for (const span of facts) {
    promptFactIds.set(span.item.ref, span.id)
  }
  const byKey = new Map(
    evaluations.map((evaluation) => [evaluation.candidateKey, evaluation]),
  )
  const candidates: ScoredCandidate[] = frameCandidates.map(
    (content, ordinal) => {
      const evaluation = byKey.get(content.key)!
      const completeness = checkCompleteness(content)
      const genericFirstTest = isGenericFirstTest(content.firstTest)
      const qualityScore =
        (0.45 * labelScore(evaluation.intentAlignment.label) +
          0.35 * labelScore(evaluation.usefulness.label) +
          0.2 * labelScore(evaluation.specificity.label)) /
        2
      const rejectionReasons: string[] = []
      for (const [dimension, score] of [
        ['intentAlignment', evaluation.intentAlignment],
        ['usefulness', evaluation.usefulness],
        ['specificity', evaluation.specificity],
      ] as const) {
        if (score.label === 'low')
          rejectionReasons.push(`LOW_QUALITY:${dimension}`)
      }
      for (const [field, complete] of Object.entries(completeness)) {
        if (!complete) rejectionReasons.push(`INCOMPLETE:${field}`)
      }
      for (const item of evaluation.constraints) {
        const constraint = constraints.find(
          (known) => known.item.ref === item.constraintRef,
        )
        if (
          constraint &&
          'strength' in constraint.item &&
          constraint.item.strength === 'hard' &&
          item.status === 'violated'
        ) {
          rejectionReasons.push(
            `HARD_CONSTRAINT_VIOLATED:${item.constraintRef}`,
          )
        }
      }
      if (genericFirstTest) rejectionReasons.push('GENERIC_FIRST_TEST')
      const eligibility = rejectionReasons.length ? 'REJECTED' : 'ELIGIBLE'
      return {
        id: randomUUID(),
        ordinal: ordinal + 1,
        content,
        evaluation,
        qualityScore,
        completeness,
        genericFirstTest,
        eligibility,
        rejectionReasons,
        selectionState:
          eligibility === 'REJECTED' ? 'REJECTED' : 'NOT_SELECTED',
        duplicateOfCandidateId: null,
        dedupSimilarity: null,
        selectionScore: null,
        selectionProbability: 0,
        selectionMetadata: {
          policyVersion: SELECTION_POLICY_VERSION,
          randomized: false,
          note: 'deterministic policy; selectionProbability is not a propensity for off-policy evaluation',
        },
        displayPosition: null,
        hypothesisSupportingFactIds:
          content.hypothesis.supportingFactRefs.flatMap((ref) => {
            const id = promptFactIds.get(ref)
            return id ? [id] : []
          }),
      }
    },
  )

  let dedupMode: 'EMBEDDING' | 'TEXT_FALLBACK' = 'EMBEDDING'
  let degraded = false
  let degradationReason: string | null = null
  let similarities: number[][]
  const eligible = candidates.filter(
    (candidate) => candidate.eligibility === 'ELIGIBLE',
  )
  try {
    const vectors = await provider.embed(
      eligible.map((candidate) =>
        [
          candidate.content.title,
          candidate.content.summary,
          candidate.content.mechanism,
        ].join(' '),
      ),
      AbortSignal.timeout(timeoutMs),
    )
    if (!isValidEmbeddingSet(vectors, eligible.length)) {
      throw new Error('Embedding provider returned an invalid vector shape')
    }
    similarities = makeSimilarityMatrix(eligible.length, (left, right) =>
      cosineSimilarity(vectors[left]!, vectors[right]!),
    )
  } catch (error) {
    // Keep the run usable when embeddings fail; record the degraded text-set fallback.
    dedupMode = 'TEXT_FALLBACK'
    degraded = true
    degradationReason =
      error instanceof Error ? error.message : 'Embedding provider failed'
    attempts.push({
      task: 'dedupe',
      ok: false,
      reason: degradationReason,
      code: 'TEXT_FALLBACK',
    })
    similarities = makeSimilarityMatrix(eligible.length, (left, right) =>
      textJaccard(
        [
          eligible[left]!.content.title,
          eligible[left]!.content.summary,
          eligible[left]!.content.mechanism,
        ].join(' '),
        [
          eligible[right]!.content.title,
          eligible[right]!.content.summary,
          eligible[right]!.content.mechanism,
        ].join(' '),
      ),
    )
  }
  attempts.push({ task: 'dedupe', ok: true, reason: dedupMode })
  markDuplicates(eligible, similarities)
  selectCandidates(candidates, eligible, similarities)
  attempts.push({
    task: 'selection',
    ok: true,
    reason: SELECTION_POLICY_VERSION,
  })
  return {
    facts: facts.filter((span) => span.item.ref.startsWith('f')),
    constraints,
    candidates,
    attempts,
    dedupMode,
    degraded,
    degradationReason,
  }
}

function checkCompleteness(candidate: FrameCandidate) {
  return {
    title: Boolean(candidate.title.trim()),
    summary: Boolean(candidate.summary.trim()),
    preservedIntent: Boolean(candidate.preservedIntent.trim()),
    changedAssumptions: candidate.changedAssumptions.some((value) =>
      value.trim(),
    ),
    fitRationale: Boolean(candidate.fitRationale.trim()),
    strongestObjection: Boolean(candidate.strongestObjection.trim()),
    firstTest: Boolean(candidate.firstTest.trim()),
    mechanism: Boolean(candidate.mechanism.trim()),
    facets: candidate.facets.some((value) => value.trim()),
    'hypothesis.statement': Boolean(candidate.hypothesis.statement.trim()),
    'hypothesis.assumptions': candidate.hypothesis.assumptions.some((value) =>
      value.trim(),
    ),
    'hypothesis.falsifiers': candidate.hypothesis.falsifiers.some((value) =>
      value.trim(),
    ),
  }
}

function isGenericFirstTest(value: string) {
  const text = value.trim()
  if (text.split(/\s+/).filter(Boolean).length < 8) return true
  if (/^(do|conduct|perform)\s+(some\s+)?(more\s+)?research\b/i.test(text))
    return true
  if (/^(talk|speak) to (some )?(people|users|customers)\.?$/i.test(text))
    return true
  if (
    /\b(think about|brainstorm|explore (the )?options|learn more|look into|figure out)\b/i.test(
      text,
    )
  )
    return true
  if (
    !/\d/.test(text) &&
    !/\b(count|measure|record|compare|ship|send|publish|ask|interview|sign up|pre-order|survey|prototype|schedule|track)\b/i.test(
      text,
    )
  )
    return true
  return false
}

function markDuplicates(eligible: ScoredCandidate[], similarities: number[][]) {
  const parent = eligible.map((_, index) => index)
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]!)
    return parent[index]!
  }
  const join = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }
  for (let left = 0; left < eligible.length; left += 1) {
    for (let right = left + 1; right < eligible.length; right += 1) {
      if (similarities[left]![right]! >= 0.92) join(left, right)
    }
  }
  const clusters = new Map<number, number[]>()
  eligible.forEach((_, index) => {
    const root = find(index)
    clusters.set(root, [...(clusters.get(root) ?? []), index])
  })
  for (const indices of clusters.values()) {
    if (indices.length < 2) continue
    const representativeIndex = [...indices].sort((left, right) => {
      const score = eligible[right]!.qualityScore - eligible[left]!.qualityScore
      return score || eligible[left]!.ordinal - eligible[right]!.ordinal
    })[0]!
    const representative = eligible[representativeIndex]!
    for (const index of indices) {
      if (index === representativeIndex) continue
      const duplicate = eligible[index]!
      duplicate.selectionState = 'DUPLICATE'
      duplicate.duplicateOfCandidateId = representative.id
      duplicate.dedupSimilarity = similarities[index]![representativeIndex]!
    }
  }
}

function selectCandidates(
  candidates: ScoredCandidate[],
  eligible: ScoredCandidate[],
  similarities: number[][],
) {
  const active = eligible.filter(
    (candidate) => candidate.selectionState !== 'DUPLICATE',
  )
  const selected: ScoredCandidate[] = []
  while (selected.length < 4) {
    const ranked = active
      .filter((candidate) => !selected.includes(candidate))
      .map((candidate) => {
        const candidateIndex = eligible.indexOf(candidate)
        const axisValues = getAxisValues(candidate.content)
        const facets = new Set(
          axisValues
            .map(normalize)
            .concat(candidate.content.facets.map(normalize)),
        )
        const covered = new Set(
          selected.flatMap((item) =>
            getAxisValues(item.content)
              .concat(item.content.facets)
              .map(normalize),
          ),
        )
        const uncovered = [...facets].filter(
          (facet) => !covered.has(facet),
        ).length
        const facetBonus =
          0.1 * (uncovered / (6 + candidate.content.facets.length))
        const redundancy =
          selected.length === 0
            ? 0
            : 0.15 *
              Math.max(
                ...selected.map(
                  (item) =>
                    similarities[candidateIndex]![eligible.indexOf(item)]!,
                ),
              )
        return {
          candidate,
          score: candidate.qualityScore + facetBonus - redundancy,
          facetBonus,
          redundancy,
        }
      })
      .filter(({ candidate }) => {
        if (selected.length !== 1) return true
        return axisDifferenceCount(selected[0]!.content, candidate.content) >= 2
      })
      .sort((left, right) => {
        const difference = right.score - left.score
        return difference || left.candidate.ordinal - right.candidate.ordinal
      })
    const next = ranked[0]
    if (!next) break
    selected.push(next.candidate)
    const position = selected.length
    next.candidate.selectionState = 'SELECTED'
    next.candidate.selectionScore = next.score
    next.candidate.selectionProbability = 1
    next.candidate.displayPosition = position
    next.candidate.selectionMetadata = {
      policyVersion: SELECTION_POLICY_VERSION,
      randomized: false,
      note: 'deterministic policy; selectionProbability is not a propensity for off-policy evaluation',
      rank: position,
      components: {
        qualityScore: next.candidate.qualityScore,
        facetBonus: next.facetBonus,
        redundancy: next.redundancy,
      },
    }
  }
  for (const candidate of candidates) {
    if (candidate.eligibility === 'REJECTED') {
      candidate.selectionState = 'REJECTED'
      candidate.selectionMetadata = {
        ...candidate.selectionMetadata,
        rank: null,
        components: {
          qualityScore: candidate.qualityScore,
          facetBonus: 0,
          redundancy: 0,
        },
      }
    } else if (candidate.selectionState === 'NOT_SELECTED') {
      candidate.selectionMetadata = {
        ...candidate.selectionMetadata,
        rank: null,
        components: {
          qualityScore: candidate.qualityScore,
          facetBonus: 0,
          redundancy: 0,
        },
      }
    }
  }
}

function getAxisValues(candidate: FrameCandidate) {
  return [
    candidate.hypothesis.axes.goal,
    candidate.hypothesis.axes.beneficiary,
    candidate.hypothesis.axes.motivation,
    candidate.hypothesis.axes.mechanism,
    candidate.hypothesis.axes.timeHorizon,
    candidate.hypothesis.axes.risk,
  ]
}

function axisDifferenceCount(left: FrameCandidate, right: FrameCandidate) {
  return getAxisValues(left).filter(
    (value, index) =>
      normalize(value) !== normalize(getAxisValues(right)[index]!),
  ).length
}

function labelScore(label: 'low' | 'medium' | 'high') {
  return label === 'high' ? 2 : label === 'medium' ? 1 : 0
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function makeSimilarityMatrix(
  length: number,
  similarity: (left: number, right: number) => number,
) {
  return Array.from({ length }, (_, left) =>
    Array.from({ length }, (_, right) =>
      left === right ? 1 : similarity(left, right),
    ),
  )
}

function isValidEmbeddingSet(vectors: number[][], expected: number) {
  if (vectors.length !== expected) return false
  if (expected === 0) return true
  const dimension = vectors[0]?.length ?? 0
  return (
    dimension > 0 &&
    vectors.every(
      (vector) =>
        vector.length === dimension &&
        vector.every((value) => Number.isFinite(value)),
    )
  )
}

function cosineSimilarity(left: number[], right: number[]) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index]!, 0)
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value ** 2, 0))
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value ** 2, 0))
  return leftNorm && rightNorm ? dot / (leftNorm * rightNorm) : 0
}

function textJaccard(left: string, right: string) {
  const stopWords = new Set([
    'a',
    'about',
    'an',
    'and',
    'as',
    'at',
    'by',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'the',
    'to',
    'with',
  ])
  const tokens = (value: string) =>
    new Set(
      (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        (token) => !stopWords.has(token),
      ),
    )
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union ? intersection / union : 1
}

function invoke(
  provider: ModelProvider,
  request: Omit<StructuredGenerationRequest, 'signal'>,
  timeoutMs: number,
  attempts: PipelineAttempt[],
  attempt: number,
) {
  const signal = AbortSignal.timeout(timeoutMs)
  return provider
    .generateStructured({ ...request, signal })
    .catch((error: unknown) => {
      const providerError =
        error instanceof ProviderError
          ? error
          : signal.aborted
            ? new ProviderError('Model request timed out', 'TIMEOUT')
            : new ProviderError(
                error instanceof Error
                  ? error.message
                  : 'Model provider failed',
                'PROVIDER_ERROR',
              )
      attempts.push({
        task: request.task,
        attempt,
        ok: false,
        code: providerError.code,
        message: providerError.message,
      })
      throw new PipelineError(
        providerError.message,
        providerError.code,
        attempts,
      )
    })
}
