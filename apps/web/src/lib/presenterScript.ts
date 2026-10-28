import type {
  CandidateDto,
  GenerationRunDto,
  PromptItemDto,
  RunProgress,
} from '@unfold/shared'

type SourceItem = Pick<
  PromptItemDto,
  'ref' | 'text' | 'evidenceText' | 'evidenceStart' | 'evidenceEnd' | 'strength'
>

type SourceCandidate = Pick<
  CandidateDto,
  | 'id'
  | 'runId'
  | 'ordinal'
  | 'qualityScore'
  | 'constraintEvaluations'
  | 'eligibility'
  | 'rejectionReasons'
  | 'selectionState'
  | 'selectionScore'
  | 'displayPosition'
> & {
  quality: CandidateDto['quality'] | null
  content: {
    title: string
    distance?: string
    fitRationale?: string
    strongestObjection?: string
    firstTest?: string
  }
}

type SourceRun = Pick<
  GenerationRunDto,
  'id' | 'status' | 'modelProvider' | 'modelName' | 'selectionPolicyVersion'
> & { rubricVersion?: string | null }

export type PresenterSource = {
  project: { originalPrompt: string }
  latestRun: SourceRun | null
  analysis: { facts: SourceItem[]; constraints: SourceItem[] }
  candidates: SourceCandidate[]
}

export type PromptSegment = {
  text: string
  kind: 'plain' | 'fact' | 'hard' | 'soft'
  ref: string | null
}

export type CheckState = 'ok' | 'mid' | 'bad'

export type PresenterCheck = { key: string; label: string; state: CheckState }

export type PresenterOutcome =
  'SELECTED' | 'NOT_SELECTED' | 'REJECTED' | 'DUPLICATE'

export type PresenterCandidate = {
  id: string
  ordinal: number
  title: string
  distance: string | null
  q: number
  checks: PresenterCheck[]
  outcome: PresenterOutcome
  stamp: string | null
  selectionScore: number | null
  fitRationale: string
  strongestObjection: string
  firstTest: string
}

export type PresenterItem = { ref: string; text: string; evidence: string }

export type PresenterDraft = { ordinal: number; title: string }

export type PresenterScript = {
  prompt: string
  segments: PromptSegment[]
  facts: PresenterItem[]
  hardConstraints: PresenterItem[]
  candidates: PresenterCandidate[]
  selected: PresenterCandidate[]
  modelLabel: string
  policyVersion: string
  rubricVersion: string | null
  drafts: PresenterDraft[]
  partialChecks: Record<string, PresenterCheck[]>
}

const RUBRIC_CHECKS = [
  ['intentCompatibility', 'Intent'],
  ['decisionUsefulness', 'Useful'],
  ['specificityCoherence', 'Specific'],
  ['firstTestExecutability', 'Testable'],
  ['nonObviousness', 'Non-obvious'],
] as const

const LEGACY_CHECKS = [
  ['intentAlignment', 'Intent'],
  ['usefulness', 'Useful'],
  ['specificity', 'Specific'],
] as const

const REASON_LABELS: Record<string, string> = {
  GENERIC_FIRST_TEST: 'Generic first test',
  HARD_CONSTRAINT_VIOLATED: 'Breaks a hard constraint',
  RESTATEMENT: 'Restates the prompt',
  SEED_LEAK: 'Leaks its seed',
  INVALID_EVIDENCE_REF: 'Cites missing evidence',
}

const MAX_CONSTRAINT_CHECKS = 2

export function buildPresenterScript(
  source: PresenterSource,
): PresenterScript | null {
  const run = source.latestRun
  if (!run || run.status !== 'SUCCEEDED') return null
  const script = assembleScript(
    {
      prompt: source.project.originalPrompt,
      modelLabel: `${run.modelProvider} · ${run.modelName}`,
      policyVersion: run.selectionPolicyVersion,
      rubricVersion: run.rubricVersion ?? null,
    },
    source.analysis.facts,
    source.analysis.constraints,
    source.candidates.filter((candidate) => candidate.runId === run.id),
  )
  return script.selected.length ? script : null
}

export type LiveMeta = {
  prompt: string
  modelLabel: string
  policyVersion: string
  rubricVersion: string | null
}

const STAGE_LEVELS: Record<RunProgress['stage'], number> = {
  STARTED: 0,
  EXTRACTED: 1,
  FRAMED: 2,
  EVALUATED: 3,
  SELECTED: 4,
}

export function scriptFromProgress(
  meta: LiveMeta,
  progress: RunProgress | null,
): { script: PresenterScript; level: number } {
  const candidates: SourceCandidate[] = (progress?.candidates ?? []).map(
    (candidate) => ({
      id: candidate.key,
      runId: 'live',
      ordinal: candidate.ordinal,
      quality: candidate.quality,
      qualityScore: candidate.qualityScore ?? 0,
      constraintEvaluations: candidate.constraintEvaluations,
      eligibility: candidate.eligibility ?? 'ELIGIBLE',
      rejectionReasons: candidate.rejectionReasons,
      selectionState: candidate.selectionState,
      selectionScore: candidate.selectionScore,
      displayPosition: candidate.displayPosition,
      content: {
        title: candidate.title,
        distance: candidate.distance ?? undefined,
        fitRationale: candidate.fitRationale,
        strongestObjection: candidate.strongestObjection,
        firstTest: candidate.firstTest,
      },
    }),
  )
  const script = assembleScript(
    meta,
    progress?.facts ?? [],
    progress?.constraints ?? [],
    candidates,
  )
  script.drafts = (progress?.drafts ?? []).map((draft) => ({
    ordinal: draft.ordinal,
    title: draft.title,
  }))
  script.partialChecks = Object.fromEntries(
    (progress?.partialScores ?? []).map((entry) => [
      entry.candidateKey,
      RUBRIC_CHECKS.flatMap(([key, label]) => {
        const score = entry.scores[key]
        if (score === undefined) return []
        return [{ key, label, state: scoreState(score) }]
      }),
    ]),
  )
  return {
    script,
    level: progress ? STAGE_LEVELS[progress.stage] : 0,
  }
}

function scoreState(score: number): CheckState {
  return score === 2 ? 'ok' : score === 1 ? 'mid' : 'bad'
}

function assembleScript(
  meta: LiveMeta,
  facts: SourceItem[],
  constraints: SourceItem[],
  sourceCandidates: SourceCandidate[],
): PresenterScript {
  const hardItems = constraints.filter((item) => item.strength === 'hard')
  const candidates = [...sourceCandidates]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((candidate) => toPresenterCandidate(candidate, hardItems))
  const positions = new Map(
    sourceCandidates.map((candidate) => [
      candidate.id,
      candidate.displayPosition ?? Number.MAX_SAFE_INTEGER,
    ]),
  )
  const selected = candidates
    .filter((candidate) => candidate.outcome === 'SELECTED')
    .sort(
      (a, b) =>
        (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0) ||
        a.ordinal - b.ordinal,
    )
  const prompt = clipPrompt(meta.prompt)
  return {
    prompt,
    segments: buildPromptSegments(prompt, facts, constraints),
    facts: facts.map(toItem),
    hardConstraints: hardItems.map(toItem),
    candidates,
    selected,
    modelLabel: meta.modelLabel,
    policyVersion: meta.policyVersion,
    rubricVersion: meta.rubricVersion,
    drafts: [],
    partialChecks: {},
  }
}

export function buildPromptSegments(
  prompt: string,
  facts: SourceItem[],
  constraints: SourceItem[],
): PromptSegment[] {
  const spans = [
    ...constraints.map((item) => ({
      item,
      kind: (item.strength === 'hard'
        ? 'hard'
        : 'soft') as PromptSegment['kind'],
    })),
    ...facts.map((item) => ({ item, kind: 'fact' as const })),
  ]
    .flatMap(({ item, kind }) => {
      const range = locate(prompt, item)
      return range ? [{ ...range, kind, ref: item.ref }] : []
    })
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const segments: PromptSegment[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    if (span.start > cursor)
      segments.push({
        text: prompt.slice(cursor, span.start),
        kind: 'plain',
        ref: null,
      })
    segments.push({
      text: prompt.slice(span.start, span.end),
      kind: span.kind,
      ref: span.ref,
    })
    cursor = span.end
  }
  if (cursor < prompt.length)
    segments.push({ text: prompt.slice(cursor), kind: 'plain', ref: null })
  return segments
}

export function rejectionLabel(reason: string) {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason]
  if (reason.startsWith('LOW_SCORE:')) {
    const criterion = reason.slice('LOW_SCORE:'.length)
    const label = RUBRIC_CHECKS.find(([key]) => key === criterion)?.[1]
    return label ? `Low score · ${label.toLowerCase()}` : 'Low score'
  }
  const words = reason.toLowerCase().replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const MAX_PROMPT_CHARS = 360

function clipPrompt(prompt: string) {
  return prompt.length > MAX_PROMPT_CHARS
    ? `${prompt.slice(0, MAX_PROMPT_CHARS - 1)}…`
    : prompt
}

function locate(prompt: string, item: SourceItem) {
  if (
    item.evidenceEnd > item.evidenceStart &&
    prompt.slice(item.evidenceStart, item.evidenceEnd) === item.evidenceText
  )
    return { start: item.evidenceStart, end: item.evidenceEnd }
  if (!item.evidenceText) return null
  const start = prompt.indexOf(item.evidenceText)
  return start < 0 ? null : { start, end: start + item.evidenceText.length }
}

function toItem(item: SourceItem): PresenterItem {
  return { ref: item.ref, text: item.text, evidence: item.evidenceText }
}

function toPresenterCandidate(
  candidate: SourceCandidate,
  hardItems: SourceItem[],
): PresenterCandidate {
  const outcome: PresenterOutcome =
    candidate.selectionState ??
    (candidate.eligibility === 'REJECTED' ? 'REJECTED' : 'NOT_SELECTED')
  return {
    id: candidate.id,
    ordinal: candidate.ordinal,
    title: candidate.content.title,
    distance: candidate.content.distance ?? null,
    q: candidate.qualityScore,
    checks: [
      ...(candidate.quality ? qualityChecks(candidate.quality) : []),
      ...constraintChecks(candidate, hardItems),
    ],
    outcome,
    stamp:
      outcome === 'REJECTED'
        ? rejectionLabel(candidate.rejectionReasons[0] ?? 'REJECTED')
        : outcome === 'DUPLICATE'
          ? 'Near duplicate'
          : outcome === 'NOT_SELECTED'
            ? 'Not selected'
            : null,
    selectionScore: candidate.selectionScore,
    fitRationale: candidate.content.fitRationale ?? '',
    strongestObjection: candidate.content.strongestObjection ?? '',
    firstTest: candidate.content.firstTest ?? '',
  }
}

function qualityChecks(quality: CandidateDto['quality']): PresenterCheck[] {
  if ('criteria' in quality) {
    return RUBRIC_CHECKS.map(([key, label]) => {
      const score = quality.criteria[key].score
      return { key, label, state: scoreState(score) }
    })
  }
  return LEGACY_CHECKS.map(([key, label]) => {
    const value = quality[key].label
    return {
      key,
      label,
      state: value === 'high' ? 'ok' : value === 'medium' ? 'mid' : 'bad',
    }
  })
}

function constraintChecks(
  candidate: SourceCandidate,
  hardItems: SourceItem[],
): PresenterCheck[] {
  return hardItems.slice(0, MAX_CONSTRAINT_CHECKS).map((item) => {
    const status = candidate.constraintEvaluations.find(
      (evaluation) => evaluation.constraintRef === item.ref,
    )?.status
    return {
      key: item.ref,
      label: item.ref,
      state:
        status === 'violated' ? 'bad' : status === 'satisfied' ? 'ok' : 'mid',
    }
  })
}
