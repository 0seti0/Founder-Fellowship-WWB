import {
  GenerationStrategySchema,
  type CandidateEvaluationV2,
  type ExtractedConstraint,
  type GenerationStrategy,
} from '@unfold/shared'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { env } from '../env'
import { currentDateContext } from '../generation/currentDate'
import { compareCandidates } from '../generation/functionalEquivalence'
import {
  EMBEDDING_DEDUP_THRESHOLD,
  RUBRIC_WEIGHTS,
  SELECTION_POLICY_VERSION,
  TEXT_FALLBACK_DEDUP_THRESHOLD,
  generatePipeline,
  PipelineError,
  type PipelineResult,
} from '../generation/pipeline'
import { createModelProvider, type ModelProvider } from '../model/provider'
import {
  EVALUATE_RUBRIC_PROMPT_VERSION,
  EVALUATE_RUBRIC_SYSTEM_PROMPT,
  EXTRACT_PROMPT_VERSION,
  EXTRACT_SYSTEM_PROMPT,
  FUNCTIONAL_EQUIVALENCE_PROMPT_VERSION,
  FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT,
} from '../generation/prompts'
import {
  calculateExperimentMetrics,
  cosineSimilarity,
  type ExperimentComparison,
  type EmbeddingSimilarityPair,
} from './metrics'

type PromptFixture = {
  id: string
  pattern: string
  prompt: string
}

type FixtureFile = {
  version: string
  label: string
  prompts: PromptFixture[]
}

type CliOptions = {
  strategies: GenerationStrategy[]
  fixturesPath: string
  seed: string
  outputPath: string
}

const packageDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
)
const experimentDirectory = resolve(packageDirectory, 'experiments')

function parseOptions(args: string[]): CliOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!flag?.startsWith('--'))
      throw new Error(`Unexpected experiment argument: ${flag ?? ''}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${flag}`)
    values.set(flag, value)
    index += 1
  }

  const strategies = values.has('--strategies')
    ? values
        .get('--strategies')!
        .split(',')
        .map((value) => GenerationStrategySchema.parse(value))
    : [...GenerationStrategySchema.options]
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return {
    strategies,
    fixturesPath: values.has('--fixtures')
      ? resolve(process.cwd(), values.get('--fixtures')!)
      : resolve(experimentDirectory, 'fixtures/prompts.json'),
    seed: values.get('--seed') ?? 'eval-v1',
    outputPath: values.has('--out')
      ? resolve(process.cwd(), values.get('--out')!)
      : resolve(experimentDirectory, 'out', timestamp),
  }
}

function cosinePairs(vectors: number[][], candidates: { id: string }[]) {
  const similarities = new Map<string, number | null>()
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      similarities.set(
        `${candidates[left]!.id}\u0000${candidates[right]!.id}`,
        cosineSimilarity(vectors[left]!, vectors[right]!),
      )
    }
  }
  return similarities
}

function similarityFor(
  similarities: Map<string, number | null>,
  leftId: string,
  rightId: string,
) {
  return (
    similarities.get(`${leftId}\u0000${rightId}`) ??
    similarities.get(`${rightId}\u0000${leftId}`) ??
    null
  )
}

function candidatesForMetrics(result: PipelineResult) {
  return result.candidates.map((candidate) => ({
    id: candidate.id,
    qualityScore: candidate.qualityScore,
    eligibility: candidate.eligibility,
  }))
}

function textForCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function providerConfiguration() {
  return {
    mode: env.MODEL_MODE,
    provider: env.LLM_PROVIDER,
    baseUrl: env.LLM_BASE_URL,
    strongModel: env.LLM_MODEL_STRONG,
    fastModel: env.LLM_MODEL_FAST,
    embeddingModel:
      env.LLM_PROVIDER === 'openai' ? env.LLM_EMBEDDING_MODEL : null,
    maxTokens: env.LLM_MAX_TOKENS,
    temperature: env.LLM_TEMPERATURE ?? null,
  }
}

async function compareFloorPassingCandidates(
  provider: ModelProvider,
  result: PipelineResult,
  originalPrompt: string,
  timeoutMs: number,
  currentDate: ReturnType<typeof currentDateContext>,
) {
  const passing = result.candidates.filter(
    (candidate) => candidate.eligibility === 'ELIGIBLE',
  )
  const texts = passing.map((candidate) =>
    [
      candidate.content.title,
      candidate.content.summary,
      candidate.content.mechanism,
    ].join(' '),
  )
  let similarities = new Map<string, number | null>()
  if (passing.length > 1) {
    try {
      const vectors = await provider.embed(
        texts,
        AbortSignal.timeout(timeoutMs),
      )
      if (
        vectors.length === passing.length &&
        vectors.every(
          (vector) =>
            vector.length > 0 &&
            vector.every((value) => Number.isFinite(value)),
        )
      ) {
        similarities = cosinePairs(vectors, passing)
      }
    } catch {
      similarities = new Map()
    }
  }

  const constraints = result.constraints.map(
    (span) => span.item as ExtractedConstraint,
  )
  const comparisons: ExperimentComparison[] = []
  const embeddingSimilarities: EmbeddingSimilarityPair[] = []
  const details: Array<Record<string, unknown>> = []
  for (let left = 0; left < passing.length; left += 1) {
    for (let right = left + 1; right < passing.length; right += 1) {
      const leftCandidate = passing[left]!
      const rightCandidate = passing[right]!
      const similarity = similarityFor(
        similarities,
        leftCandidate.id,
        rightCandidate.id,
      )
      embeddingSimilarities.push({
        leftId: leftCandidate.id,
        rightId: rightCandidate.id,
        similarity,
      })
      try {
        const comparison = await compareCandidates(provider, {
          originalPrompt,
          left: leftCandidate.content,
          right: rightCandidate.content,
          constraints,
          timeoutMs,
          currentDate,
        })
        comparisons.push({
          leftId: leftCandidate.id,
          rightId: rightCandidate.id,
          verdict: comparison.verdict,
          similarity,
        })
        details.push({
          leftCandidateId: leftCandidate.id,
          rightCandidateId: rightCandidate.id,
          verdict: comparison.verdict,
          rationale: comparison.rationale,
          similarity,
          attempts: comparison.attempts,
        })
      } catch (error) {
        details.push({
          leftCandidateId: leftCandidate.id,
          rightCandidateId: rightCandidate.id,
          errorCode:
            error instanceof PipelineError ? error.code : 'PROVIDER_ERROR',
          error: error instanceof Error ? error.message : 'Comparison failed',
          attempts: error instanceof PipelineError ? error.attempts : undefined,
          similarity: similarityFor(
            similarities,
            leftCandidate.id,
            rightCandidate.id,
          ),
        })
      }
    }
  }
  return { comparisons, details, embeddingSimilarities }
}

async function recordPromptStrategy(
  fixture: PromptFixture,
  strategy: GenerationStrategy,
  seed: string,
  provider: ModelProvider,
) {
  const currentDate = currentDateContext()
  const startedAt = performance.now()
  let result: PipelineResult | null = null
  let generationError: unknown
  try {
    result = await generatePipeline({
      prompt: fixture.prompt,
      provider,
      timeoutMs: env.MODEL_TIMEOUT_MS,
      strategy,
      explorationSeed: seed,
      currentDate,
    })
  } catch (error) {
    generationError = error
  }
  const generationLatencyMs = Math.round(performance.now() - startedAt)
  const comparisonStartedAt = performance.now()
  const comparison = result
    ? await compareFloorPassingCandidates(
        provider,
        result,
        fixture.prompt,
        env.MODEL_TIMEOUT_MS,
        currentDate,
      )
    : { comparisons: [], details: [], embeddingSimilarities: [] }
  const comparisonLatencyMs = Math.round(
    performance.now() - comparisonStartedAt,
  )
  const latencyMs = Math.round(performance.now() - startedAt)
  const candidates = result?.candidates ?? []
  const selected = candidates
    .filter((candidate) => candidate.selectionState === 'SELECTED')
    .sort((left, right) => left.displayPosition! - right.displayPosition!)
  const metrics = result
    ? calculateExperimentMetrics(
        candidatesForMetrics(result),
        comparison.comparisons,
        selected.map((candidate) => candidate.id),
        comparison.embeddingSimilarities,
      )
    : calculateExperimentMetrics([], [], [])
  const attempts =
    generationError instanceof PipelineError
      ? generationError.attempts
      : (result?.attempts ?? [])
  const tokenUsage = [
    ...attempts,
    ...comparison.details.flatMap((detail) =>
      Array.isArray(detail.attempts)
        ? (detail.attempts as PipelineResult['attempts'])
        : [],
    ),
  ]
    .map((attempt) => attempt.metadata?.usage)
    .filter((usage) => usage !== undefined)

  return {
    promptId: fixture.id,
    promptPattern: fixture.pattern,
    originalPrompt: fixture.prompt,
    strategy,
    strategyVersion: 'v1',
    seed,
    provider: provider.identity,
    providerConfiguration: providerConfiguration(),
    latencyMs,
    generationLatencyMs,
    functionalEquivalenceLatencyMs: comparisonLatencyMs,
    generationError:
      generationError instanceof Error
        ? {
            code:
              generationError instanceof PipelineError
                ? generationError.code
                : 'GENERATION_FAILED',
            message: generationError.message,
          }
        : null,
    attempts,
    prompts: {
      extract: {
        promptVersion: EXTRACT_PROMPT_VERSION,
        system: EXTRACT_SYSTEM_PROMPT,
      },
      frame: result?.generationMeta.calls ?? [],
      evaluate: {
        promptVersion: EVALUATE_RUBRIC_PROMPT_VERSION,
        system: EVALUATE_RUBRIC_SYSTEM_PROMPT,
      },
      compare: {
        promptVersion: FUNCTIONAL_EQUIVALENCE_PROMPT_VERSION,
        system: FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT,
      },
    },
    generationMeta: result?.generationMeta ?? null,
    schemaOutcomes: {
      extraction: {
        passed: attempts.some(
          (attempt) => attempt.task === 'extract' && attempt.ok,
        ),
        failures: attempts.filter(
          (attempt) => attempt.task === 'extract' && !attempt.ok,
        ),
      },
      frame: {
        passed: attempts.some(
          (attempt) => attempt.task === 'frame' && attempt.ok,
        ),
        failures: attempts.filter(
          (attempt) => attempt.task === 'frame' && !attempt.ok,
        ),
      },
      evaluation: {
        passed: attempts.some(
          (attempt) => attempt.task === 'evaluate' && attempt.ok,
        ),
        failures: attempts.filter(
          (attempt) => attempt.task === 'evaluate' && !attempt.ok,
        ),
      },
    },
    facts: result?.facts.map((span) => span.item) ?? [],
    constraints: result?.constraints.map((span) => span.item) ?? [],
    rubric: {
      version: result?.rubricVersion ?? null,
      weights: RUBRIC_WEIGHTS,
      formula: 'Q(c) = Σ(weight_i × score_i / 2)',
      floorRules: [
        'Reject any hard-gate failure.',
        'Reject score 0 on intentCompatibility, decisionUsefulness, specificityCoherence, or firstTestExecutability.',
        'Reject nonObviousness score 0 when the candidate is a pure restatement or generic default.',
      ],
    },
    selectionPolicy: {
      version: SELECTION_POLICY_VERSION,
      formula: 'selectionScore(c | S) = Q(c) − 0.15 × R(c, S)',
      tieBreakers: ['lower generation index', 'candidate id lexicographic'],
    },
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      ordinal: candidate.ordinal,
      content: candidate.content,
      generationMeta: candidate.generationMeta,
      evaluation: candidate.evaluation,
      rubricScores:
        'intentCompatibility' in candidate.evaluation
          ? Object.fromEntries(
              Object.entries(RUBRIC_WEIGHTS).map(([criterion, weight]) => {
                const evaluation = (
                  candidate.evaluation as CandidateEvaluationV2
                )[criterion as keyof typeof RUBRIC_WEIGHTS]
                return [
                  criterion,
                  {
                    score: evaluation.score,
                    rationale: evaluation.rationale,
                    weight,
                  },
                ]
              }),
            )
          : null,
      q: candidate.qualityScore,
      floor: {
        passed: candidate.eligibility === 'ELIGIBLE',
        failures: candidate.rejectionReasons,
      },
      dedup: {
        state: candidate.selectionState,
        duplicateOfCandidateId: candidate.duplicateOfCandidateId,
        similarity: candidate.dedupSimilarity,
      },
      selection: {
        score: candidate.selectionScore,
        displayPosition: candidate.displayPosition,
        metadata: candidate.selectionMetadata,
      },
      hypothesisSupportingFactIds: candidate.hypothesisSupportingFactIds,
    })),
    deduplication: result
      ? {
          mode: result.dedupMode,
          thresholds: {
            embeddingCosine: EMBEDDING_DEDUP_THRESHOLD,
            textFallbackJaccard: TEXT_FALLBACK_DEDUP_THRESHOLD,
          },
          degraded: result.degraded,
          degradationReason: result.degradationReason,
        }
      : null,
    selectedSlate: selected.map((candidate) => ({
      candidateId: candidate.id,
      ordinal: candidate.ordinal,
      q: candidate.qualityScore,
      displayPosition: candidate.displayPosition,
    })),
    pairwiseFunctionalEquivalence: comparison.details,
    pairwiseEmbeddingSimilarities: comparison.embeddingSimilarities,
    metrics,
    tokenUsage,
  }
}

async function readFixtures(path: string): Promise<FixtureFile> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as FixtureFile
  if (
    !Array.isArray(parsed.prompts) ||
    parsed.prompts.some(
      (fixture) =>
        typeof fixture.id !== 'string' ||
        typeof fixture.pattern !== 'string' ||
        typeof fixture.prompt !== 'string',
    )
  ) {
    throw new Error(`Invalid prompt fixtures: ${path}`)
  }
  return parsed
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const options = parseOptions(args)
  const fixtures = await readFixtures(options.fixturesPath)
  await mkdir(options.outputPath, { recursive: true })
  const records: string[] = []
  const reviewRows = [
    [
      'prompt_id',
      'strategy',
      'candidate_id',
      'title',
      'summary',
      'mechanism',
      'human_would_test',
      'human_notes',
    ],
  ]

  for (const fixture of fixtures.prompts) {
    for (const strategy of options.strategies) {
      const provider = createModelProvider(env)
      const record = await recordPromptStrategy(
        fixture,
        strategy,
        options.seed,
        provider,
      )
      records.push(JSON.stringify(record))
      for (const candidate of record.candidates) {
        if (!candidate.floor.passed) continue
        reviewRows.push([
          fixture.id,
          strategy,
          candidate.id,
          String(candidate.content.title),
          String(candidate.content.summary),
          String(candidate.content.mechanism),
          '',
          '',
        ])
      }
    }
  }

  await writeFile(
    resolve(options.outputPath, 'results.jsonl'),
    `${records.join('\n')}\n`,
  )
  await writeFile(
    resolve(options.outputPath, 'human-review.csv'),
    `${reviewRows.map((row) => row.map(textForCsv).join(',')).join('\n')}\n`,
  )
  console.log(
    JSON.stringify({
      outputPath: options.outputPath,
      fixtureCount: fixtures.prompts.length,
      strategies: options.strategies,
      records: records.length,
      modelMode: env.MODEL_MODE,
    }),
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Experiment failed')
    process.exitCode = 1
  })
}
