import {
  EvaluateOutputV2Schema,
  ExpandOutputSchema,
  ExtractionOutputSchema,
  FrameSingleOutputSchema,
  FrameOutputSchema,
  SsotOutputSchema,
  type CandidateQuality,
  type CandidateEvaluation,
  type CandidateEvaluationV2,
  type ExtractedConstraint,
  type ExtractedFact,
  type FrameCandidate,
  type GenerationStrategy,
  type IdeaContent,
  type ProgressCandidate,
  type ProgressItem,
  type RunProgress,
  type UnaryOperator,
} from '@unfold/shared'
import { OPERATOR_REGISTRY } from '../operators/registry'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  EVALUATE_RUBRIC_PROMPT_VERSION,
  EVALUATE_RUBRIC_SYSTEM_PROMPT,
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SYSTEM_PROMPT,
  FRAME_AXIS_FREE_PROMPT_VERSION,
  FRAME_AXIS_FREE_SYSTEM_PROMPT,
  FRAME_PARAPHRASE_PROMPT_VERSION,
  FRAME_RANDOM_STRING_PROMPT_VERSION,
  FRAME_SINGLE_PROMPT_VERSION,
  FRAME_SINGLE_SYSTEM_PROMPT,
  RANDOM_STRING_ADDENDUM,
  SSOT_PROMPT_VERSION,
  SSOT_SYSTEM_PROMPT,
  FRAME_PROMPT_VERSION,
  FRAME_SYSTEM_PROMPT,
  EXPAND_PROMPT_VERSION_V3,
  EXPAND_SCHEMA_VERSION,
  EXPAND_SYSTEM_PROMPT_V3,
  frameParaphraseSystemPrompt,
} from './prompts'
import { currentDateContext, type CurrentDateContext } from './currentDate'
import {
  ProviderError,
  type ModelProvider,
  type StructuredGenerationRequest,
} from '../model/provider'

export const SCHEMA_VERSION = 'idea-schema-v2'
export const RUBRIC_VERSION = 'candidate-rubric-v2'
export const SELECTION_POLICY_VERSION = 'initial-mmr-v3'
export const EMBEDDING_DEDUP_THRESHOLD = 0.92
export const TEXT_FALLBACK_DEDUP_THRESHOLD = 0.8
export const EXPANSION_SELECTION_POLICY_VERSION = 'expansion-mmr-v2'
export const RUBRIC_WEIGHTS = {
  intentCompatibility: 0.3,
  decisionUsefulness: 0.2,
  specificityCoherence: 0.15,
  firstTestExecutability: 0.2,
  nonObviousness: 0.15,
} as const
const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export type PipelineAttempt = {
  task:
    | 'extract'
    | 'frame'
    | 'evaluate'
    | 'expand'
    | 'compare'
    | 'dedupe'
    | 'selection'
  attempt?: number
  ok: boolean
  code?: string
  message?: string
  reason?: string
  metadata?: Record<string, unknown>
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
  evaluation: CandidateEvaluation | CandidateEvaluationV2
  generationMeta?: Record<string, unknown> | null
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
  strategy: GenerationStrategy
  rubricVersion: string
  generationMeta: Record<string, unknown>
}

type PipelineOptions = {
  prompt: string
  provider: ModelProvider
  timeoutMs: number
  strategy?: GenerationStrategy
  explorationSeed?: string
  onProgress?: (progress: RunProgress) => void | Promise<void>
  currentDate?: CurrentDateContext
}

async function emitProgress(
  onProgress: PipelineOptions['onProgress'],
  progress: RunProgress,
) {
  try {
    await onProgress?.(progress)
  } catch {}
}

type ProgressEmitter = {
  partial(progress: RunProgress): void
  stage(progress: RunProgress): Promise<void>
}

const progressStageIndex: Record<RunProgress['stage'], number> = {
  STARTED: 0,
  EXTRACTED: 1,
  FRAMED: 2,
  EVALUATED: 3,
  SELECTED: 4,
}

function createProgressEmitter(
  onProgress: PipelineOptions['onProgress'],
): ProgressEmitter {
  let chain = Promise.resolve()
  let currentStageIndex = -1
  let lastPartialAt = Number.NEGATIVE_INFINITY
  let pending: RunProgress | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let partialQueued = false
  let stagePending = false

  const write = async (snapshot: RunProgress) => {
    try {
      await onProgress?.(snapshot)
    } catch {}
  }
  const schedulePending = () => {
    if (!pending || timer || partialQueued || stagePending) return
    const delay = Math.max(0, 400 - (Date.now() - lastPartialAt))
    timer = setTimeout(() => {
      timer = null
      const snapshot = pending
      pending = null
      if (snapshot) enqueuePartial(snapshot)
    }, delay)
  }
  const enqueuePartial = (snapshot: RunProgress) => {
    partialQueued = true
    chain = chain
      .then(async () => {
        lastPartialAt = Date.now()
        await write(snapshot)
      })
      .then(() => {
        partialQueued = false
        schedulePending()
      })
  }

  return {
    partial(snapshot) {
      if (progressStageIndex[snapshot.stage] < currentStageIndex) return
      if (stagePending) return
      pending = snapshot
      if (
        !partialQueued &&
        !timer &&
        !stagePending &&
        Date.now() - lastPartialAt >= 400
      ) {
        pending = null
        enqueuePartial(snapshot)
      } else {
        schedulePending()
      }
    },
    async stage(snapshot) {
      const stageIndex = progressStageIndex[snapshot.stage]
      if (stageIndex < currentStageIndex) return
      currentStageIndex = stageIndex
      stagePending = true
      pending = null
      if (timer) clearTimeout(timer)
      timer = null
      const stageWrite = chain.then(() => write(snapshot))
      chain = stageWrite
      await stageWrite
      stagePending = false
    },
  }
}

function progressItems(spans: EvidenceSpan[]): ProgressItem[] {
  return spans.map(({ item, start, end }) => ({
    ref: item.ref,
    kind: 'strength' in item ? 'CONSTRAINT' : 'FACT',
    text: item.text,
    evidenceText: item.evidence,
    evidenceStart: start,
    evidenceEnd: end,
    strength: 'strength' in item ? item.strength : null,
  }))
}

function framedProgressCandidate(
  content: FrameCandidate,
  ordinal: number,
): ProgressCandidate {
  return {
    key: content.key,
    ordinal,
    title: content.title,
    distance: content.distance ?? null,
    fitRationale: content.fitRationale,
    strongestObjection: content.strongestObjection,
    firstTest: content.firstTest,
    quality: null,
    qualityScore: null,
    constraintEvaluations: [],
    eligibility: null,
    rejectionReasons: [],
    selectionState: null,
    selectionScore: null,
    displayPosition: null,
  }
}

export function qualityForCandidate(
  candidate: ScoredCandidate,
): CandidateQuality {
  const evaluation = candidate.evaluation
  if ('intentAlignment' in evaluation) {
    return {
      intentAlignment: evaluation.intentAlignment,
      usefulness: evaluation.usefulness,
      specificity: evaluation.specificity,
    }
  }
  return {
    rubricVersion: RUBRIC_VERSION,
    criteria: {
      intentCompatibility: {
        ...evaluation.intentCompatibility,
        weight: RUBRIC_WEIGHTS.intentCompatibility,
      },
      decisionUsefulness: {
        ...evaluation.decisionUsefulness,
        weight: RUBRIC_WEIGHTS.decisionUsefulness,
      },
      specificityCoherence: {
        ...evaluation.specificityCoherence,
        weight: RUBRIC_WEIGHTS.specificityCoherence,
      },
      firstTestExecutability: {
        ...evaluation.firstTestExecutability,
        weight: RUBRIC_WEIGHTS.firstTestExecutability,
      },
      nonObviousness: {
        ...evaluation.nonObviousness,
        weight: RUBRIC_WEIGHTS.nonObviousness,
      },
    },
    q: candidate.qualityScore,
    floor: {
      passed: candidate.eligibility === 'ELIGIBLE',
      failures: candidate.rejectionReasons,
    },
  }
}

function evaluatedProgressCandidate(
  candidate: ScoredCandidate,
  constraints: EvidenceSpan[],
): ProgressCandidate {
  const constraintsByRef = new Map(
    constraints.map((span) => [span.item.ref, span.item]),
  )
  return {
    ...framedProgressCandidate(candidate.content, candidate.ordinal),
    quality: qualityForCandidate(candidate),
    qualityScore: candidate.qualityScore,
    constraintEvaluations: candidate.evaluation.constraints.map((result) => {
      const constraint = constraintsByRef.get(result.constraintRef)
      return {
        ...result,
        ...(constraint && 'strength' in constraint
          ? { text: constraint.text, strength: constraint.strength }
          : {}),
      }
    }),
    eligibility: candidate.eligibility,
    rejectionReasons: candidate.rejectionReasons,
  }
}

function selectedProgressCandidate(
  candidate: ScoredCandidate,
  constraints: EvidenceSpan[],
): ProgressCandidate {
  return {
    ...evaluatedProgressCandidate(candidate, constraints),
    selectionState: candidate.selectionState,
    selectionScore: candidate.selectionScore,
    displayPosition: candidate.displayPosition,
  }
}

const promptVersions = {
  extract: EXTRACT_PROMPT_VERSION,
  frame: FRAME_PROMPT_VERSION,
  evaluate: EVALUATE_RUBRIC_PROMPT_VERSION,
}

export async function generatePipeline({
  prompt,
  provider,
  timeoutMs,
  strategy = 'JOINT_AXIS_FREE_V1',
  explorationSeed,
  onProgress,
  currentDate: suppliedCurrentDate,
}: PipelineOptions): Promise<PipelineResult> {
  const currentDate = suppliedCurrentDate ?? currentDateContext()
  const progress = createProgressEmitter(onProgress)
  const attempts: PipelineAttempt[] = []
  const extracted = await extract(
    prompt,
    provider,
    timeoutMs,
    attempts,
    currentDate,
  )
  const facts = extracted.facts.map((span) => span.item as ExtractedFact)
  const constraints = extracted.constraints.map(
    (span) => span.item as ExtractedConstraint,
  )
  const factsProgress = progressItems(extracted.facts)
  const constraintsProgress = progressItems(extracted.constraints)
  await progress.stage({
    stage: 'EXTRACTED',
    facts: factsProgress,
    constraints: constraintsProgress,
    candidates: [],
  })
  const framed = await frame(
    prompt,
    facts,
    constraints,
    provider,
    timeoutMs,
    attempts,
    strategy,
    currentDate,
    explorationSeed,
    (partial) => {
      const rawCandidates =
        partial &&
        typeof partial === 'object' &&
        Array.isArray((partial as { candidates?: unknown }).candidates)
          ? (partial as { candidates: unknown[] }).candidates
          : []
      const drafts = rawCandidates.flatMap((value, index) => {
        if (!value || typeof value !== 'object') return []
        const entry = value as Record<string, unknown>
        if (typeof entry.title !== 'string' || !entry.title.trim()) return []
        return [
          {
            ordinal: index + 1,
            title: entry.title,
            summary: typeof entry.summary === 'string' ? entry.summary : null,
          },
        ]
      })
      progress.partial({
        stage: 'EXTRACTED',
        facts: factsProgress,
        constraints: constraintsProgress,
        candidates: [],
        drafts,
      })
    },
  )
  const framedProgress = {
    stage: 'FRAMED',
    facts: factsProgress,
    constraints: constraintsProgress,
    candidates: framed.candidates.map((candidate, index) =>
      framedProgressCandidate(candidate, index + 1),
    ),
  } satisfies RunProgress
  await progress.stage(framedProgress)
  const evaluations = await evaluateV2(
    framed.candidates,
    prompt,
    constraints,
    provider,
    timeoutMs,
    attempts,
    currentDate,
    (partial) => {
      const rawEvaluations =
        partial &&
        typeof partial === 'object' &&
        Array.isArray((partial as { evaluations?: unknown }).evaluations)
          ? (partial as { evaluations: unknown[] }).evaluations
          : []
      const criterionKeys = [
        'intentCompatibility',
        'decisionUsefulness',
        'specificityCoherence',
        'firstTestExecutability',
        'nonObviousness',
      ] as const
      const partialScores = rawEvaluations.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const entry = value as Record<string, unknown>
        if (typeof entry.candidateKey !== 'string') return []
        const scores: Partial<Record<(typeof criterionKeys)[number], number>> =
          {}
        for (const key of criterionKeys) {
          const criterion = entry[key]
          if (
            criterion &&
            typeof criterion === 'object' &&
            Number.isInteger((criterion as { score?: unknown }).score) &&
            (criterion as { score: number }).score >= 0 &&
            (criterion as { score: number }).score <= 2
          ) {
            scores[key] = (criterion as { score: number }).score
          }
        }
        return [{ candidateKey: entry.candidateKey, scores }]
      })
      progress.partial({ ...framedProgress, partialScores })
    },
  )
  return completePipeline({
    facts: extracted.facts,
    constraints: extracted.constraints,
    frameCandidates: framed.candidates,
    evaluations,
    provider,
    timeoutMs,
    attempts,
    generationMeta: framed.metadata,
    strategy,
    additionalRejectionReasons: framed.rejectionReasons,
    onProgress,
    progress,
  })
}

export function calculateQ(evaluation: CandidateEvaluationV2) {
  return Object.entries(RUBRIC_WEIGHTS).reduce(
    (sum, [criterion, weight]) =>
      sum +
      weight * (evaluation[criterion as keyof typeof RUBRIC_WEIGHTS].score / 2),
    0,
  )
}

export async function expandPipeline(options: {
  operator: UnaryOperator
  parent: IdeaContent
  rootPrompt: string
  facts: ExtractedFact[]
  factIds?: Map<string, string>
  constraints: ExtractedConstraint[]
  assumption?: string
  mechanism?: string
  suitabilityScore?: number
  provider: ModelProvider
  timeoutMs: number
  currentDate?: CurrentDateContext
  existingChildren?: Array<{
    id: string
    title: string
    summary: string
    mechanism: string
  }>
}) {
  const currentDate = options.currentDate ?? currentDateContext()
  const attempts: PipelineAttempt[] = []
  const definition = OPERATOR_REGISTRY[options.operator]
  let content: IdeaContent[] | undefined
  let effectRejections = new Map<string, string[]>()
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await invoke(
      options.provider,
      {
        task: 'expand',
        promptVersion: EXPAND_PROMPT_VERSION_V3,
        schemaVersion: EXPAND_SCHEMA_VERSION,
        system: EXPAND_SYSTEM_PROMPT_V3,
        input: {
          currentDate,
          operator: options.operator,
          instruction: definition.instruction,
          exclusions: definition.exclusions,
          rootPrompt: options.rootPrompt,
          parent: options.parent,
          facts: options.facts,
          constraints: options.constraints,
          assumption: options.assumption,
          mechanism: options.mechanism,
          count: 6,
        },
      },
      options.timeoutMs,
      attempts,
      attempt,
    )
    const parsed = ExpandOutputSchema.safeParse(response)
    let errorCode = 'MALFORMED_OUTPUT'
    let errorMessage = parsed.success ? '' : parsed.error.message
    if (parsed.success) {
      const validRefs = new Set(options.facts.map((fact) => fact.ref))
      const valid = parsed.data.candidates.every((candidate) =>
        candidate.hypothesis.supportingFactRefs.every((ref) =>
          validRefs.has(ref),
        ),
      )
      const unique =
        new Set(parsed.data.candidates.map((candidate) => candidate.key))
          .size === parsed.data.candidates.length
      if (parsed.data.operator !== options.operator) {
        errorCode = 'OPERATOR_MISMATCH'
        errorMessage = 'Expansion operator did not match the requested operator'
      } else if (!unique || !valid) {
        errorCode = 'MALFORMED_OUTPUT'
        errorMessage = !unique
          ? 'Expansion candidate keys must be unique'
          : 'Expansion cited a missing supporting fact'
      } else {
        effectRejections = new Map(
          parsed.data.candidates.map((candidate) => [
            candidate.key,
            definition
              .validateEffect(candidate, {
                parents: [
                  {
                    id: 'parent',
                    type: 'IDEA',
                    status: 'VISIBLE',
                    operator: null,
                    content: options.parent,
                  },
                ],
                assumption: options.assumption,
              })
              .map((code) => `OPERATOR_EFFECT:${code}`),
          ]),
        )
        content = parsed.data.candidates
      }
    }
    if (content) {
      recordAttempt(attempts, { task: 'expand', attempt, ok: true })
      break
    }
    recordAttempt(attempts, {
      task: 'expand',
      attempt,
      ok: false,
      code: errorCode,
      message: errorMessage,
    })
    if (attempt === 2)
      throw new PipelineError(
        errorMessage || 'Expansion output was invalid',
        errorCode,
        attempts,
      )
  }
  const evaluations = await evaluateV2(
    content!,
    options.rootPrompt,
    options.constraints,
    options.provider,
    options.timeoutMs,
    attempts,
    currentDate,
  )
  return completePipeline({
    facts: options.facts.map((item) => ({
      id: options.factIds?.get(item.ref) ?? randomUUID(),
      item,
      start: 0,
      end: 0,
    })),
    constraints: options.constraints.map((item, index) => ({
      id: `constraint-${index}`,
      item,
      start: 0,
      end: 0,
    })),
    frameCandidates: content!,
    evaluations,
    provider: options.provider,
    timeoutMs: options.timeoutMs,
    attempts,
    maximumSelected: 3,
    policyVersion: EXPANSION_SELECTION_POLICY_VERSION,
    suitability: options.suitabilityScore ?? 0.5,
    existingChildren: options.existingChildren ?? [],
    additionalRejectionReasons: effectRejections,
    strategy: 'JOINT_AXIS_FREE_V1',
    generationMeta: {},
  })
}

async function extract(
  prompt: string,
  provider: ModelProvider,
  timeoutMs: number,
  attempts: PipelineAttempt[],
  currentDate: CurrentDateContext,
): Promise<{ facts: EvidenceSpan[]; constraints: EvidenceSpan[] }> {
  let retryEvidence: string[] = []
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const repairMessage = retryEvidence.length
      ? `These evidence strings were rejected because they are not exact substrings of originalPrompt: ${retryEvidence.map((evidence) => JSON.stringify(evidence)).join(', ')}. Copy each evidence string verbatim from originalPrompt.`
      : null
    const result = await invoke(
      provider,
      {
        task: 'extract',
        promptVersion: promptVersions.extract,
        schemaVersion: SCHEMA_VERSION,
        system: repairMessage
          ? `${EXTRACT_SYSTEM_PROMPT}\n\n${repairMessage}`
          : EXTRACT_SYSTEM_PROMPT,
        input: { prompt, currentDate },
      },
      timeoutMs,
      attempts,
      attempt,
    )
    const parsed = ExtractionOutputSchema.safeParse(result)
    if (!parsed.success) {
      recordAttempt(attempts, {
        task: 'extract',
        attempt,
        ok: false,
        code: 'MALFORMED_OUTPUT',
        message: parsed.error.message,
        metadata: { evidenceSnapped: 0 },
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
    const invalidEvidence: string[] = []
    let evidenceSnapped = 0
    for (const item of [...parsed.data.facts, ...parsed.data.constraints]) {
      let start = prompt.indexOf(item.evidence)
      let end: number
      if (start >= 0) {
        end = start + item.evidence.length
      } else {
        const snapped = snapEvidenceToPrompt(prompt, item.evidence)
        if (!snapped) {
          invalidEvidence.push(item.evidence)
          continue
        }
        item.evidence = snapped.text
        start = snapped.start
        end = snapped.end
        evidenceSnapped += 1
      }
      const span = {
        id: randomUUID(),
        item,
        start,
        end,
      }
      if (item.ref.startsWith('f')) facts.push(span)
      else constraints.push(span)
    }
    if (invalidEvidence.length > 0) {
      retryEvidence = invalidEvidence
      recordAttempt(attempts, {
        task: 'extract',
        attempt,
        ok: false,
        code: 'INVALID_EVIDENCE',
        message: 'Evidence must be an exact substring of the original prompt',
        metadata: { evidenceSnapped },
      })
      if (attempt === 2)
        throw new PipelineError(
          'Extraction included evidence not contained in the prompt',
          'INVALID_EVIDENCE',
          attempts,
        )
      continue
    }
    recordAttempt(attempts, {
      task: 'extract',
      attempt,
      ok: true,
      metadata: { evidenceSnapped },
    })
    return { facts, constraints }
  }
  throw new PipelineError('Extraction failed', 'MALFORMED_OUTPUT', attempts)
}

function normalizeEvidenceCharacters(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[‘’‚‛]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[–—−]/gu, '-')
    .toLowerCase()
}

function normalizePromptWithMap(prompt: string) {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

  for (const { segment, index } of segmenter.segment(prompt)) {
    const normalizedSegment = normalizeEvidenceCharacters(segment)
    for (const character of normalizedSegment) {
      const sourceEnd = index + segment.length
      if (/\s/u.test(character)) {
        if (text.endsWith(' ')) {
          ends[ends.length - 1] = sourceEnd
        } else {
          text += ' '
          starts.push(index)
          ends.push(sourceEnd)
        }
        continue
      }

      text += character
      for (let unit = 0; unit < character.length; unit += 1) {
        starts.push(index)
        ends.push(sourceEnd)
      }
    }
  }

  return { text, starts, ends }
}

function snapEvidenceToPrompt(prompt: string, evidence: string) {
  const normalizedEvidence = normalizeEvidenceCharacters(evidence)
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.,;:!?]+$/u, '')
    .trim()
  if (!normalizedEvidence) return null

  const normalizedPrompt = normalizePromptWithMap(prompt)
  const normalizedStart = normalizedPrompt.text.indexOf(normalizedEvidence)
  if (normalizedStart < 0) return null

  const normalizedEnd = normalizedStart + normalizedEvidence.length - 1
  const start = normalizedPrompt.starts[normalizedStart]
  const end = normalizedPrompt.ends[normalizedEnd]
  if (start === undefined || end === undefined) return null

  return {
    text: prompt.slice(start, end),
    start,
    end,
  }
}

async function frame(
  prompt: string,
  facts: ExtractedFact[],
  constraints: ExtractedConstraint[],
  provider: ModelProvider,
  timeoutMs: number,
  attempts: PipelineAttempt[],
  strategy: GenerationStrategy,
  currentDate: CurrentDateContext,
  explorationSeed?: string,
  onPartial?: (partial: unknown) => void,
): Promise<{
  candidates: FrameCandidate[]
  metadata: Record<string, unknown>
  rejectionReasons: Map<string, string[]>
}> {
  const independent =
    strategy !== 'JOINT_AXIS_V1' && strategy !== 'JOINT_AXIS_FREE_V1'
  const candidates: FrameCandidate[] = []
  const metadata: Record<string, unknown> = {
    strategy,
    calls: [],
  }
  const rejectionReasons = new Map<string, string[]>()
  const seedStrings: string[] = []

  if (!independent) {
    const axisFree = strategy === 'JOINT_AXIS_FREE_V1'
    const promptVersion = axisFree
      ? FRAME_AXIS_FREE_PROMPT_VERSION
      : FRAME_PROMPT_VERSION
    const system = axisFree
      ? FRAME_AXIS_FREE_SYSTEM_PROMPT
      : FRAME_SYSTEM_PROMPT
    const callMeta = {
      index: 0,
      promptVersion,
      system,
      instructionVariant: null,
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await invoke(
        provider,
        {
          task: 'frame',
          promptVersion,
          schemaVersion: SCHEMA_VERSION,
          system,
          input: {
            currentDate,
            originalPrompt: prompt,
            facts,
            constraints,
            strategy,
          },
          onPartial,
        },
        timeoutMs,
        attempts,
        attempt,
      )
      const parsed = FrameOutputSchema.safeParse(result)
      if (!parsed.success) {
        recordAttempt(attempts, {
          task: 'frame',
          attempt,
          ok: false,
          code: 'MALFORMED_OUTPUT',
          message: parsed.error.message,
          reason: promptVersion,
          metadata: callMeta,
        })
        if (attempt === 2)
          throw new PipelineError(
            'Frame output did not match the required schema',
            'MALFORMED_OUTPUT',
            attempts,
          )
        continue
      }
      candidates.push(...parsed.data.candidates)
      recordAttempt(attempts, {
        task: 'frame',
        attempt,
        ok: true,
        reason: promptVersion,
        metadata: callMeta,
      })
      metadata.calls = [callMeta]
      break
    }
  } else {
    for (let index = 0; index < 6; index += 1) {
      const randomString =
        strategy === 'PARAPHRASE_RANDOM_STRING_V1'
          ? explorationSeed
            ? deterministicExplorationString(explorationSeed, index)
            : randomExplorationString()
          : undefined
      const promptVersion =
        strategy === 'SSOT_V1'
          ? SSOT_PROMPT_VERSION
          : strategy === 'PARAPHRASE_ENSEMBLE_V1'
            ? FRAME_PARAPHRASE_PROMPT_VERSION
            : strategy === 'PARAPHRASE_RANDOM_STRING_V1'
              ? FRAME_RANDOM_STRING_PROMPT_VERSION
              : FRAME_SINGLE_PROMPT_VERSION
      const system =
        strategy === 'SSOT_V1'
          ? SSOT_SYSTEM_PROMPT
          : strategy === 'PARAPHRASE_ENSEMBLE_V1'
            ? frameParaphraseSystemPrompt(index)
            : strategy === 'PARAPHRASE_RANDOM_STRING_V1'
              ? `${frameParaphraseSystemPrompt(index)}${RANDOM_STRING_ADDENDUM}`
              : FRAME_SINGLE_SYSTEM_PROMPT
      const callMeta: Record<string, unknown> = {
        index,
        promptVersion,
        system,
        instructionVariant:
          strategy === 'PARAPHRASE_ENSEMBLE_V1' ||
          strategy === 'PARAPHRASE_RANDOM_STRING_V1'
            ? index
            : null,
        ...(randomString ? { explorationString: randomString } : {}),
      }
      ;(metadata.calls as unknown[]).push(callMeta)
      if (randomString) seedStrings.push(randomString)
      let candidate: FrameCandidate | null = null
      let returnedSeed: string | undefined
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = await invoke(
          provider,
          {
            task: 'frame',
            promptVersion,
            schemaVersion: SCHEMA_VERSION,
            system,
            input: {
              currentDate,
              originalPrompt: prompt,
              facts,
              constraints,
              ...(randomString ? { explorationString: randomString } : {}),
            },
          },
          timeoutMs,
          attempts,
          attempt,
        )
        const parsed =
          strategy === 'SSOT_V1'
            ? SsotOutputSchema.safeParse(result)
            : FrameSingleOutputSchema.safeParse(result)
        if (!parsed.success) {
          recordAttempt(attempts, {
            task: 'frame',
            attempt,
            ok: false,
            code: 'MALFORMED_OUTPUT',
            message: parsed.error.message,
          })
          if (attempt === 2)
            throw new PipelineError(
              'Single-candidate frame output did not match the required schema',
              'MALFORMED_OUTPUT',
              attempts,
            )
          continue
        }
        candidate = parsed.data.candidate
        if ('seed' in parsed.data && typeof parsed.data.seed === 'string')
          returnedSeed = parsed.data.seed
        const validFactRefs = new Set(facts.map((fact) => fact.ref))
        if (
          !candidate.hypothesis.supportingFactRefs.every((ref) =>
            validFactRefs.has(ref),
          )
        ) {
          candidate = null
          attempts.push({
            task: 'frame',
            attempt,
            ok: false,
            code: 'MALFORMED_OUTPUT',
            message: 'A candidate cited a missing supporting fact',
          })
          if (attempt === 2)
            throw new PipelineError(
              'Frame candidate referenced a missing fact',
              'MALFORMED_OUTPUT',
              attempts,
            )
          continue
        }
        recordAttempt(attempts, {
          task: 'frame',
          attempt,
          ok: true,
          reason: promptVersion,
          metadata: callMeta,
        })
        break
      }
      if (!candidate)
        throw new PipelineError(
          'Single-candidate frame generation failed',
          'MALFORMED_OUTPUT',
          attempts,
        )
      candidate.key = `k${index + 1}`
      if (returnedSeed) {
        seedStrings.push(returnedSeed)
        callMeta['returnedSeed'] = returnedSeed
      }
      const leaked = seedStrings.some(
        (seed) => seed.length >= 6 && containsSeed(candidate!, seed),
      )
      if (leaked) rejectionReasons.set(candidate.key, ['SEED_LEAK'])
      if (seedStrings.length) stripSeeds(candidate, seedStrings)
      candidates.push(candidate)
    }
  }

  const calls = metadata.calls as Array<Record<string, unknown>>
  metadata.seedStrings = seedStrings
  metadata.candidateMetadata = Object.fromEntries(
    candidates.map((candidate, index) => {
      const call = calls[index] ?? calls[0]
      return [
        candidate.key,
        {
          strategy,
          strategyVersion: 'v1',
          callIndex: Number(call?.index ?? 0),
          promptVersion: String(call?.promptVersion ?? ''),
          instructionVariant: call?.instructionVariant ?? null,
          systemPrompt: String(call?.system ?? ''),
          explorationString: call?.explorationString ?? null,
          returnedSeed: call?.returnedSeed ?? null,
        },
      ]
    }),
  )
  return { candidates, metadata, rejectionReasons }
}

async function evaluateV2(
  candidates: FrameCandidate[],
  originalPrompt: string,
  constraints: ExtractedConstraint[],
  provider: ModelProvider,
  timeoutMs: number,
  attempts: PipelineAttempt[],
  currentDate: CurrentDateContext,
  onPartial?: (partial: unknown) => void,
): Promise<CandidateEvaluationV2[]> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await invoke(
      provider,
      {
        task: 'evaluate',
        promptVersion: EVALUATE_RUBRIC_PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        system: EVALUATE_RUBRIC_SYSTEM_PROMPT,
        input: {
          currentDate,
          originalPrompt,
          constraints,
          candidates: candidates.map((candidate) => ({
            key: candidate.key,
            content: candidate,
          })),
        },
        onPartial,
      },
      timeoutMs,
      attempts,
      attempt,
    )
    const parsed = EvaluateOutputV2Schema.safeParse(result)
    const coverageError = parsed.success
      ? evaluationCoverageError(
          parsed.data.evaluations,
          candidates,
          constraints,
        )
      : null
    if (!parsed.success || coverageError) {
      recordAttempt(attempts, {
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
    recordAttempt(attempts, {
      task: 'evaluate',
      attempt,
      ok: true,
      reason: EVALUATE_RUBRIC_PROMPT_VERSION,
    })
    return parsed.data.evaluations
  }
  throw new PipelineError('Evaluation failed', 'MALFORMED_OUTPUT', attempts)
}

function evaluationCoverageError(
  evaluations: CandidateEvaluationV2[],
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

async function completePipeline({
  facts,
  constraints,
  frameCandidates,
  evaluations,
  provider,
  timeoutMs,
  attempts,
  strategy,
  generationMeta,
  maximumSelected = 4,
  policyVersion = SELECTION_POLICY_VERSION,
  suitability = 0,
  existingChildren = [],
  additionalRejectionReasons = new Map(),
  onProgress,
  progress,
}: {
  facts: EvidenceSpan[]
  constraints: EvidenceSpan[]
  frameCandidates: FrameCandidate[]
  evaluations: CandidateEvaluationV2[]
  provider: ModelProvider
  timeoutMs: number
  attempts: PipelineAttempt[]
  strategy: GenerationStrategy
  generationMeta: Record<string, unknown>
  maximumSelected?: number
  policyVersion?: string
  suitability?: number
  existingChildren?: Array<{
    id: string
    title: string
    summary: string
    mechanism: string
  }>
  additionalRejectionReasons?: Map<string, string[]>
  onProgress?: PipelineOptions['onProgress']
  progress?: ProgressEmitter
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
      const qualityScore = calculateQ(evaluation)
      const rejectionReasons: string[] = []
      rejectionReasons.push(
        ...(additionalRejectionReasons.get(content.key) ?? []),
      )
      const validFactRefs = new Set(facts.map((span) => span.item.ref))
      for (const ref of content.hypothesis.supportingFactRefs) {
        if (!validFactRefs.has(ref))
          rejectionReasons.push(`INVALID_EVIDENCE_REF:${ref}`)
      }
      for (const criterion of [
        'intentCompatibility',
        'decisionUsefulness',
        'specificityCoherence',
        'firstTestExecutability',
      ] as const) {
        if (evaluation[criterion].score === 0)
          rejectionReasons.push(`LOW_SCORE:${criterion}`)
      }
      if (evaluation.nonObviousness.score === 0)
        rejectionReasons.push('RESTATEMENT')
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
        generationMeta:
          (
            generationMeta.candidateMetadata as
              Record<string, Record<string, unknown>> | undefined
          )?.[content.key] ?? null,
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
          policyVersion,
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

  const evaluatedSnapshot: RunProgress = {
    stage: 'EVALUATED',
    facts: progressItems(facts),
    constraints: progressItems(constraints),
    candidates: candidates.map((candidate) =>
      evaluatedProgressCandidate(candidate, constraints),
    ),
  }
  if (progress) await progress.stage(evaluatedSnapshot)
  else await emitProgress(onProgress, evaluatedSnapshot)

  let dedupMode: 'EMBEDDING' | 'TEXT_FALLBACK' = 'EMBEDDING'
  let degraded = false
  let degradationReason: string | null = null
  let similarities: number[][]
  let existingChildSimilarities: number[][] = []
  const eligible = candidates.filter(
    (candidate) => candidate.eligibility === 'ELIGIBLE',
  )
  const candidateTexts = eligible.map((candidate) =>
    [
      candidate.content.title,
      candidate.content.summary,
      candidate.content.mechanism,
    ].join(' '),
  )
  const existingChildTexts = existingChildren.map((child) =>
    [child.title, child.summary, child.mechanism].join(' '),
  )
  try {
    const vectors = await provider.embed(
      [...candidateTexts, ...existingChildTexts],
      AbortSignal.timeout(timeoutMs),
    )
    if (
      !isValidEmbeddingSet(vectors, eligible.length + existingChildren.length)
    ) {
      throw new Error('Embedding provider returned an invalid vector shape')
    }
    similarities = makeSimilarityMatrix(eligible.length, (left, right) =>
      cosineSimilarity(vectors[left]!, vectors[right]!),
    )
    existingChildSimilarities = eligible.map((_, candidateIndex) =>
      existingChildren.map((_, childIndex) =>
        cosineSimilarity(
          vectors[candidateIndex]!,
          vectors[eligible.length + childIndex]!,
        ),
      ),
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
      textJaccard(candidateTexts[left]!, candidateTexts[right]!),
    )
    existingChildSimilarities = candidateTexts.map((candidateText) =>
      existingChildTexts.map((childText) =>
        textJaccard(candidateText, childText),
      ),
    )
  }
  attempts.push({ task: 'dedupe', ok: true, reason: dedupMode })
  markDuplicates(
    eligible,
    similarities,
    dedupMode === 'EMBEDDING'
      ? EMBEDDING_DEDUP_THRESHOLD
      : TEXT_FALLBACK_DEDUP_THRESHOLD,
  )
  markExistingChildDuplicates(
    eligible,
    existingChildren,
    existingChildSimilarities,
    dedupMode === 'EMBEDDING'
      ? EMBEDDING_DEDUP_THRESHOLD
      : TEXT_FALLBACK_DEDUP_THRESHOLD,
  )
  selectCandidates(candidates, eligible, similarities, {
    maximumSelected,
    policyVersion,
    suitability,
  })
  attempts.push({
    task: 'selection',
    ok: true,
    reason: SELECTION_POLICY_VERSION,
  })
  const selectedSnapshot: RunProgress = {
    stage: 'SELECTED',
    facts: progressItems(facts),
    constraints: progressItems(constraints),
    candidates: candidates.map((candidate) =>
      selectedProgressCandidate(candidate, constraints),
    ),
  }
  if (progress) await progress.stage(selectedSnapshot)
  else await emitProgress(onProgress, selectedSnapshot)
  return {
    facts: facts.filter((span) => span.item.ref.startsWith('f')),
    constraints,
    candidates,
    attempts,
    dedupMode,
    degraded,
    degradationReason,
    strategy,
    rubricVersion: RUBRIC_VERSION,
    generationMeta,
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

function markDuplicates(
  eligible: ScoredCandidate[],
  similarities: number[][],
  threshold: number,
) {
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
      if (similarities[left]![right]! >= threshold) join(left, right)
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
      return (
        score ||
        eligible[left]!.ordinal - eligible[right]!.ordinal ||
        eligible[left]!.id.localeCompare(eligible[right]!.id)
      )
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

function markExistingChildDuplicates(
  eligible: ScoredCandidate[],
  existingChildren: Array<{ id: string }>,
  similarities: number[][],
  threshold: number,
) {
  eligible.forEach((candidate, candidateIndex) => {
    if (candidate.selectionState === 'DUPLICATE') return
    let bestIndex = -1
    let bestSimilarity = threshold
    similarities[candidateIndex]?.forEach((similarity, childIndex) => {
      if (similarity >= bestSimilarity) {
        bestSimilarity = similarity
        bestIndex = childIndex
      }
    })
    if (bestIndex < 0) return
    candidate.selectionState = 'DUPLICATE'
    candidate.dedupSimilarity = bestSimilarity
    candidate.selectionMetadata = {
      ...candidate.selectionMetadata,
      duplicateOfNodeId: existingChildren[bestIndex]!.id,
    }
  })
}

export function selectCandidates(
  candidates: ScoredCandidate[],
  eligible: ScoredCandidate[],
  similarities: number[][],
  options: {
    maximumSelected?: number
    policyVersion?: string
    suitability?: number
  } = {},
) {
  const maximumSelected = options.maximumSelected ?? 4
  const policyVersion = options.policyVersion ?? SELECTION_POLICY_VERSION
  const suitability = options.suitability ?? 0
  const active = eligible.filter(
    (candidate) => candidate.selectionState !== 'DUPLICATE',
  )
  const selected: ScoredCandidate[] = []
  while (selected.length < maximumSelected) {
    const ranked = active
      .filter((candidate) => !selected.includes(candidate))
      .map((candidate) => {
        const candidateIndex = eligible.indexOf(candidate)
        const redundancy =
          selected.length === 0
            ? 0
            : Math.max(
                ...selected.map((item) =>
                  Math.max(
                    0,
                    Math.min(
                      1,
                      similarities[candidateIndex]![eligible.indexOf(item)]!,
                    ),
                  ),
                ),
              )
        const expansion = policyVersion === EXPANSION_SELECTION_POLICY_VERSION
        const baseScore = expansion
          ? 0.7 * candidate.qualityScore + 0.3 * suitability
          : candidate.qualityScore
        return {
          candidate,
          score: baseScore - 0.15 * redundancy,
          baseScore,
          redundancy,
        }
      })
      .sort((left, right) => {
        const difference = right.score - left.score
        return (
          difference ||
          left.candidate.ordinal - right.candidate.ordinal ||
          left.candidate.id.localeCompare(right.candidate.id)
        )
      })
    const next = ranked[0]
    if (!next) break
    selected.push(next.candidate)
    const position = selected.length
    next.candidate.selectionState = 'SELECTED'
    next.candidate.selectionScore = next.score
    next.candidate.selectionProbability = 1
    next.candidate.displayPosition = position
    const expansion = policyVersion === EXPANSION_SELECTION_POLICY_VERSION
    next.candidate.selectionMetadata = {
      policyVersion,
      randomized: false,
      note: 'deterministic policy; selectionProbability is not a propensity for off-policy evaluation',
      rank: position,
      components: {
        q: next.candidate.qualityScore,
        ...(expansion ? { operatorSuitability: suitability } : {}),
        base: next.baseScore,
        redundancy: next.redundancy,
        score: next.score,
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
          redundancy: 0,
        },
      }
    } else if (candidate.selectionState === 'NOT_SELECTED') {
      candidate.selectionMetadata = {
        ...candidate.selectionMetadata,
        rank: null,
        components: {
          qualityScore: candidate.qualityScore,
          redundancy: 0,
        },
      }
    }
  }
}

function deterministicExplorationString(seed: string, index: number) {
  const bytes = createHash('sha256').update(`${seed}:${index}`).digest()
  return Array.from(bytes.subarray(0, 16))
    .map((byte) => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length])
    .join('')
}

function randomExplorationString() {
  return Array.from(randomBytes(16))
    .map((byte) => RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length])
    .join('')
}

function containsSeed(value: unknown, seed: string): boolean {
  if (typeof value === 'string')
    return value.toLowerCase().includes(seed.toLowerCase())
  if (Array.isArray(value))
    return value.some((item) => containsSeed(item, seed))
  if (value && typeof value === 'object')
    return Object.values(value).some((item) => containsSeed(item, seed))
  return false
}

function stripSeeds(candidate: FrameCandidate, seeds: string[]) {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let cleaned = value
      for (const seed of seeds) {
        if (seed.length >= 6)
          cleaned = cleaned.replace(new RegExp(escapeRegex(seed), 'gi'), '')
      }
      return cleaned.trim() || '[seed removed]'
    }
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, visit(item)]),
      )
    return value
  }
  Object.assign(candidate, visit(candidate))
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function recordAttempt(attempts: PipelineAttempt[], attempt: PipelineAttempt) {
  const previous = attempts.at(-1)
  if (
    previous &&
    previous.task === attempt.task &&
    previous.attempt === attempt.attempt &&
    (previous.metadata?.pendingProviderAttempt === true ||
      previous.ok === false)
  ) {
    Object.assign(previous, attempt, {
      metadata: {
        ...previous.metadata,
        ...attempt.metadata,
        pendingProviderAttempt: undefined,
      },
    })
    return previous
  }
  attempts.push(attempt)
  return attempt
}

function invoke(
  provider: ModelProvider,
  request: Omit<StructuredGenerationRequest, 'signal'>,
  timeoutMs: number,
  attempts: PipelineAttempt[],
  attempt: number,
) {
  const signal = AbortSignal.timeout(timeoutMs)
  const recorded = recordAttempt(attempts, {
    task: request.task,
    attempt,
    ok: false,
    metadata: { pendingProviderAttempt: true },
  })
  return provider
    .generateStructured({
      ...request,
      signal,
      onUsage: (usage) => {
        recorded.metadata = {
          ...recorded.metadata,
          usage,
        }
      },
    })
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
      recordAttempt(attempts, {
        task: request.task,
        attempt,
        ok: false,
        code: providerError.code,
        message: providerError.message,
        metadata: recorded.metadata,
      })
      throw new PipelineError(
        providerError.message,
        providerError.code,
        attempts,
      )
    })
}
