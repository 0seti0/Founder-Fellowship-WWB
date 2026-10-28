import type {
  CandidateDto,
  GenerationRunDto,
  PromptItemDto,
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
  | 'quality'
  | 'qualityScore'
  | 'constraintEvaluations'
  | 'eligibility'
  | 'rejectionReasons'
  | 'selectionState'
  | 'selectionScore'
  | 'displayPosition'
> & {
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
  const hardItems = source.analysis.constraints.filter(
    (item) => item.strength === 'hard',
  )
  const candidates = source.candidates
    .filter((candidate) => candidate.runId === run.id)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((candidate) => toPresenterCandidate(candidate, hardItems))
  const selected = candidates
    .filter((candidate) => candidate.outcome === 'SELECTED')
    .sort(
      (a, b) =>
        (displayPositionOf(source, a.id) ?? Number.MAX_SAFE_INTEGER) -
          (displayPositionOf(source, b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.ordinal - b.ordinal,
    )
  if (!selected.length) return null
  const prompt = clipPrompt(source.project.originalPrompt)
  return {
    prompt,
    segments: buildPromptSegments(
      prompt,
      source.analysis.facts,
      source.analysis.constraints,
    ),
    facts: source.analysis.facts.map(toItem),
    hardConstraints: hardItems.map(toItem),
    candidates,
    selected,
    modelLabel: `${run.modelProvider} · ${run.modelName}`,
    policyVersion: run.selectionPolicyVersion,
    rubricVersion: run.rubricVersion ?? null,
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

function displayPositionOf(source: PresenterSource, id: string) {
  return source.candidates.find((candidate) => candidate.id === id)
    ?.displayPosition
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
      ...qualityChecks(candidate.quality),
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
      return {
        key,
        label,
        state: score === 2 ? 'ok' : score === 1 ? 'mid' : 'bad',
      }
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
