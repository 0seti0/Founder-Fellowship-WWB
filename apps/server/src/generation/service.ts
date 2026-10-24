import {
  type ExtractedConstraint,
  type MockScenario,
  type ProjectDto,
  type CandidateDto,
  type GenerationRunDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type PromptItemDto,
} from '@unfold/shared'
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../db/client'
import { appendEvent } from '../db/event-repository'
import {
  candidates,
  edges,
  generationRuns,
  hypotheses,
  nodes,
  projects,
  promptAnalyses,
  promptItems,
} from '../db/schema'
import type { ModelMode } from '@unfold/shared'
import { createModelProvider, ProviderError } from '../model/provider'
import { applyGraphPatch, GraphPatchError } from '../graph/patch'
import {
  generatePipeline,
  PipelineError,
  SCHEMA_VERSION,
  SELECTION_POLICY_VERSION,
  type PipelineAttempt,
  type PipelineResult,
} from './pipeline'
import {
  EVALUATE_PROMPT_VERSION,
  EXTRACT_PROMPT_VERSION,
  FRAME_PROMPT_VERSION,
} from './prompts'

export class GenerationServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'BAD_REQUEST',
  ) {
    super(message)
    this.name = 'GenerationServiceError'
  }
}

export async function createProject(
  connection: DatabaseConnection,
  options: {
    prompt: string
    mockScenario?: MockScenario
    modelMode: ModelMode
    timeoutMs: number
  },
) {
  const projectId = randomUUID()
  const rootNodeId = randomUUID()
  const createdAt = new Date()
  const title = options.prompt.trim().split(/\s+/).slice(0, 8).join(' ')
  await connection.db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      title: title.slice(0, 191) || 'Untitled idea',
      originalPrompt: options.prompt,
      createdAt,
      updatedAt: createdAt,
    })
    await tx.insert(nodes).values({
      id: rootNodeId,
      projectId,
      type: 'ROOT_PROMPT',
      origin: 'PROMPT',
      operator: null,
      runId: null,
      candidateId: null,
      title: 'Your prompt',
      summary: options.prompt,
      content: { prompt: options.prompt },
      displayPosition: null,
      createdAt,
    })
    await appendEvent(tx, {
      id: randomUUID(),
      projectId,
      runId: null,
      nodeId: rootNodeId,
      type: 'PROJECT_CREATED',
      payload: { rootNodeId },
      dedupeKey: null,
      createdAt,
    })
  })
  const generation = await generateInitial(connection, {
    projectId,
    mockScenario: options.mockScenario,
    modelMode: options.modelMode,
    timeoutMs: options.timeoutMs,
  })
  return { projectId, ...generation }
}

export async function generateInitial(
  connection: DatabaseConnection,
  options: {
    projectId: string
    mockScenario?: MockScenario
    modelMode: ModelMode
    timeoutMs: number
  },
) {
  const { db } = connection
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, options.projectId))
    .limit(1)
  if (!project)
    throw new GenerationServiceError('Project not found', 'NOT_FOUND')

  const succeeded = await db
    .select({ id: generationRuns.id })
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.projectId, options.projectId),
        eq(generationRuns.kind, 'INITIAL'),
        eq(generationRuns.status, 'SUCCEEDED'),
      ),
    )
    .limit(1)
  if (succeeded.length) {
    throw new GenerationServiceError(
      'An initial generation has already succeeded',
      'BAD_REQUEST',
    )
  }

  const runId = randomUUID()
  const startedAt = new Date()
  const provider = createModelProvider(
    { MODEL_MODE: options.modelMode },
    { mockScenario: options.mockScenario },
  )
  await db.insert(generationRuns).values({
    id: runId,
    projectId: options.projectId,
    kind: 'INITIAL',
    status: 'RUNNING',
    modelProvider: provider.identity.provider,
    modelName: provider.identity.model,
    promptVersions: {
      extract: EXTRACT_PROMPT_VERSION,
      frame: FRAME_PROMPT_VERSION,
      evaluate: EVALUATE_PROMPT_VERSION,
    },
    schemaVersion: SCHEMA_VERSION,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
    dedupMode: null,
    degraded: false,
    attempts: [],
    errorCode: null,
    errorMessage: null,
    mockScenario: options.mockScenario ?? null,
    startedAt,
    finishedAt: null,
  })

  let attempts: PipelineAttempt[] = []
  try {
    const pipeline = await generatePipeline({
      prompt: project.originalPrompt,
      provider,
      timeoutMs: options.timeoutMs,
    })
    attempts = pipeline.attempts
    await persistPipeline(connection, options.projectId, runId, pipeline)

    const selected = pipeline.candidates
      .filter((candidate) => candidate.selectionState === 'SELECTED')
      .sort((left, right) => left.displayPosition! - right.displayPosition!)
    if (!selected.length) {
      throw new PipelineError(
        'No candidates met the eligibility and quality requirements',
        'NO_ELIGIBLE_CANDIDATES',
        pipeline.attempts,
      )
    }

    const [root] = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(
        and(
          eq(nodes.projectId, options.projectId),
          eq(nodes.type, 'ROOT_PROMPT'),
        ),
      )
      .limit(1)
    if (!root) throw new Error('Project root node is missing')

    await applyGraphPatch(db, {
      projectId: options.projectId,
      runId,
      ops: selected.map((candidate) => ({
        op: 'ADD_IDEA',
        candidateId: candidate.id,
        parentNodeIds: [root.id],
        displayPosition: candidate.displayPosition!,
      })),
    })
    return { runId, status: 'SUCCEEDED' as const, errorCode: null }
  } catch (error) {
    const code =
      error instanceof PipelineError
        ? error.code
        : error instanceof GraphPatchError
          ? error.code
          : error instanceof ProviderError
            ? error.code
            : 'GENERATION_FAILED'
    const message =
      error instanceof Error ? error.message : 'Generation failed unexpectedly'
    if (error instanceof PipelineError) attempts = error.attempts
    else if (!attempts.length) {
      attempts = [{ task: 'selection', ok: false, code, message }]
    }
    await db.transaction(async (tx) => {
      await tx
        .update(generationRuns)
        .set({
          status: 'FAILED',
          attempts,
          errorCode: code,
          errorMessage: message,
          finishedAt: new Date(),
        })
        .where(eq(generationRuns.id, runId))
      await appendEvent(tx, {
        id: randomUUID(),
        projectId: options.projectId,
        runId,
        nodeId: null,
        type: 'GENERATION_FAILED',
        payload: { code, message },
        dedupeKey: null,
        createdAt: new Date(),
      })
    })
    return { runId, status: 'FAILED' as const, errorCode: code }
  }
}

async function persistPipeline(
  connection: DatabaseConnection,
  projectId: string,
  runId: string,
  pipeline: PipelineResult,
) {
  const { db } = connection
  await db.transaction(async (tx) => {
    const analysisId = randomUUID()
    await tx.insert(promptAnalyses).values({
      id: analysisId,
      projectId,
      runId,
      promptVersion: EXTRACT_PROMPT_VERSION,
    })
    for (const span of [...pipeline.facts, ...pipeline.constraints]) {
      const isFact = span.item.ref.startsWith('f')
      const constraint = isFact ? null : (span.item as ExtractedConstraint)
      await tx.insert(promptItems).values({
        id: span.id,
        analysisId,
        projectId,
        ref: span.item.ref,
        kind: isFact ? 'FACT' : 'CONSTRAINT',
        text: span.item.text,
        evidenceText: span.item.evidence,
        evidenceStart: span.start,
        evidenceEnd: span.end,
        strength: constraint?.strength ?? null,
        basis: constraint?.basis ?? null,
      })
    }
    for (const candidate of pipeline.candidates) {
      await tx.insert(candidates).values({
        id: candidate.id,
        projectId,
        runId,
        ordinal: candidate.ordinal,
        modelKey: candidate.content.key,
        content: candidate.content,
        constraintEvaluations: candidate.evaluation.constraints,
        quality: {
          intentAlignment: candidate.evaluation.intentAlignment,
          usefulness: candidate.evaluation.usefulness,
          specificity: candidate.evaluation.specificity,
        },
        completeness: candidate.completeness,
        genericFirstTest: candidate.genericFirstTest,
        eligibility: candidate.eligibility,
        rejectionReasons: candidate.rejectionReasons,
        qualityScore: candidate.qualityScore,
        duplicateOfCandidateId: candidate.duplicateOfCandidateId,
        dedupSimilarity: candidate.dedupSimilarity,
        selectionState: candidate.selectionState,
        selectionScore: candidate.selectionScore,
        displayPosition: candidate.displayPosition,
        selectionProbability: candidate.selectionProbability,
        selectionMetadata: candidate.selectionMetadata,
        promptVersion: FRAME_PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        policyVersion: SELECTION_POLICY_VERSION,
        nodeId: null,
      })
      await tx.insert(hypotheses).values({
        id: randomUUID(),
        projectId,
        runId,
        candidateId: candidate.id,
        statement: candidate.content.hypothesis.statement,
        axes: candidate.content.hypothesis.axes,
        assumptions: candidate.content.hypothesis.assumptions,
        supportingFactIds: candidate.hypothesisSupportingFactIds,
        counterevidence: candidate.content.hypothesis.counterevidence,
        falsifiers: candidate.content.hypothesis.falsifiers,
      })
    }
    await tx
      .update(generationRuns)
      .set({
        attempts: pipeline.attempts,
        dedupMode: pipeline.dedupMode,
        degraded: pipeline.degraded,
      })
      .where(eq(generationRuns.id, runId))
  })
}

export async function listProjects(connection: DatabaseConnection) {
  return connection.db
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt))
    .then((rows) => rows.map(toProjectDto))
}

export async function getProject(
  connection: DatabaseConnection,
  projectId: string,
) {
  const { db } = connection
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project)
    throw new GenerationServiceError('Project not found', 'NOT_FOUND')

  const [latestRun] = await db
    .select()
    .from(generationRuns)
    .where(eq(generationRuns.projectId, projectId))
    .orderBy(desc(generationRuns.startedAt))
    .limit(1)
  const projectNodes = await db
    .select()
    .from(nodes)
    .where(eq(nodes.projectId, projectId))
    .orderBy(nodes.displayPosition)
  const projectEdges = await db
    .select()
    .from(edges)
    .where(eq(edges.projectId, projectId))
  const analysis = latestRun
    ? await db
        .select()
        .from(promptAnalyses)
        .where(eq(promptAnalyses.runId, latestRun.id))
        .limit(1)
    : []
  const items = analysis[0]
    ? await db
        .select()
        .from(promptItems)
        .where(eq(promptItems.analysisId, analysis[0].id))
    : []
  const candidateRows = latestRun
    ? await db
        .select()
        .from(candidates)
        .where(eq(candidates.runId, latestRun.id))
        .orderBy(candidates.ordinal)
    : []
  const hypothesisRows = candidateRows.length
    ? await db
        .select()
        .from(hypotheses)
        .where(eq(hypotheses.runId, latestRun!.id))
    : []
  const constraintItems = new Map(
    items
      .filter((item) => item.kind === 'CONSTRAINT')
      .map((item) => [item.ref, item]),
  )
  const hypothesisByCandidateId = new Map(
    hypothesisRows.map((hypothesis) => [hypothesis.candidateId, hypothesis]),
  )
  const candidateDtos: CandidateDto[] = candidateRows.flatMap((candidate) => {
    const hypothesis = hypothesisByCandidateId.get(candidate.id)
    if (!hypothesis) return []
    return [
      {
        id: candidate.id,
        ordinal: candidate.ordinal,
        content: candidate.content,
        constraintEvaluations: candidate.constraintEvaluations.map((result) => {
          const constraint = constraintItems.get(result.constraintRef)
          return {
            ...result,
            ...(constraint
              ? {
                  text: constraint.text,
                  strength: constraint.strength as 'hard' | 'soft',
                }
              : {}),
          }
        }),
        quality: candidate.quality,
        qualityScore: candidate.qualityScore,
        eligibility: candidate.eligibility,
        rejectionReasons: candidate.rejectionReasons,
        selectionState: candidate.selectionState,
        displayPosition: candidate.displayPosition,
        hypothesis: {
          statement: hypothesis.statement,
          axes: hypothesis.axes,
          assumptions: hypothesis.assumptions,
          supportingFactRefs: candidate.content.hypothesis.supportingFactRefs,
          counterevidence: hypothesis.counterevidence,
          falsifiers: hypothesis.falsifiers,
        },
      },
    ]
  })

  return {
    project: toProjectDto(project),
    nodes: projectNodes.map(toNodeDto),
    edges: projectEdges.map(toEdgeDto),
    latestRun: latestRun ? toRunDto(latestRun) : null,
    analysis: {
      facts: items.filter((item) => item.kind === 'FACT').map(toPromptItemDto),
      constraints: items
        .filter((item) => item.kind === 'CONSTRAINT')
        .map(toPromptItemDto),
    },
    candidates: candidateDtos,
  }
}

export function toProjectDto(
  project: typeof projects.$inferSelect,
): ProjectDto {
  return {
    id: project.id,
    title: project.title,
    originalPrompt: project.originalPrompt,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

function toNodeDto(node: typeof nodes.$inferSelect): GraphNodeDto {
  return {
    id: node.id,
    projectId: node.projectId,
    type: node.type,
    origin: node.origin,
    operator: node.operator,
    runId: node.runId,
    candidateId: node.candidateId,
    title: node.title,
    summary: node.summary,
    content: node.content,
    displayPosition: node.displayPosition,
    createdAt: node.createdAt.toISOString(),
  }
}

function toEdgeDto(edge: typeof edges.$inferSelect): GraphEdgeDto {
  return {
    id: edge.id,
    projectId: edge.projectId,
    parentId: edge.parentId,
    childId: edge.childId,
    runId: edge.runId,
    createdAt: edge.createdAt.toISOString(),
  }
}

function toRunDto(run: typeof generationRuns.$inferSelect): GenerationRunDto {
  return {
    id: run.id,
    projectId: run.projectId,
    kind: run.kind,
    status: run.status,
    modelProvider: run.modelProvider,
    modelName: run.modelName,
    promptVersions: run.promptVersions,
    schemaVersion: run.schemaVersion,
    selectionPolicyVersion: run.selectionPolicyVersion,
    dedupMode: run.dedupMode,
    degraded: run.degraded,
    attempts: run.attempts,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    mockScenario: run.mockScenario,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }
}

function toPromptItemDto(item: typeof promptItems.$inferSelect): PromptItemDto {
  return {
    id: item.id,
    ref: item.ref,
    kind: item.kind,
    text: item.text,
    evidenceText: item.evidenceText,
    evidenceStart: item.evidenceStart,
    evidenceEnd: item.evidenceEnd,
    strength: item.strength,
    basis: item.basis,
  }
}
