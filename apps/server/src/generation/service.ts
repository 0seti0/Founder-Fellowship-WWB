import {
  type ExtractedConstraint,
  type MockScenario,
  type ProjectDto,
  type CandidateDto,
  type GenerationRunDto,
  type GraphEdgeDto,
  type GraphNodeDto,
  type PromptItemDto,
  type UnaryOperator,
  type IdeaContent,
} from '@unfold/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
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
  EXPANSION_SELECTION_POLICY_VERSION,
  expandPipeline,
  generatePipeline,
  qualityForCandidate,
  PipelineError,
  RUBRIC_VERSION,
  SCHEMA_VERSION,
  SELECTION_POLICY_VERSION,
  type PipelineAttempt,
  type PipelineResult,
} from './pipeline'
import {
  EVALUATE_RUBRIC_PROMPT_VERSION,
  EXPAND_PROMPT_VERSION_V2,
  EXTRACT_PROMPT_VERSION,
  FRAME_AXIS_FREE_PROMPT_VERSION,
} from './prompts'
import {
  OPERATOR_REGISTRY,
  OPERATOR_REGISTRY_VERSION,
  getOperatorOptions,
  type ParentContext,
} from '../operators/registry'
import {
  computePlanningFeatures,
  PLANNING_FEATURES_VERSION,
  SUITABILITY_VERSION,
} from '../operators/planning'

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
  const projectId = await createProjectRoot(connection, options.prompt)
  const generation = await generateInitial(connection, {
    projectId,
    mockScenario: options.mockScenario,
    modelMode: options.modelMode,
    timeoutMs: options.timeoutMs,
  })
  return { projectId, ...generation }
}

async function createProjectRoot(
  connection: DatabaseConnection,
  prompt: string,
) {
  const projectId = randomUUID()
  const rootNodeId = randomUUID()
  const createdAt = new Date()
  const title = prompt.trim().split(/\s+/).slice(0, 8).join(' ')
  await connection.db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      title: title.slice(0, 191) || 'Untitled idea',
      originalPrompt: prompt,
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
      summary: prompt.slice(0, 600),
      content: { prompt },
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
  return projectId
}

export async function startInitial(
  connection: DatabaseConnection,
  options: {
    prompt: string
    mockScenario?: MockScenario
    modelMode: ModelMode
    timeoutMs: number
  },
): Promise<{ projectId: string; runId: string; completion: Promise<void> }> {
  const projectId = await createProjectRoot(connection, options.prompt)
  const runId = await beginInitial(connection, {
    projectId,
    mockScenario: options.mockScenario,
    modelMode: options.modelMode,
    timeoutMs: options.timeoutMs,
  })
  const completion = executeInitial(connection, {
    projectId,
    runId,
    mockScenario: options.mockScenario,
    modelMode: options.modelMode,
    timeoutMs: options.timeoutMs,
  }).then(
    () => undefined,
    () => {
      try {
        console.error('Background initial generation failed', { runId })
      } catch {}
    },
  )
  return { projectId, runId, completion }
}

export async function beginInitial(
  connection: DatabaseConnection,
  options: {
    projectId: string
    mockScenario?: MockScenario
    modelMode: ModelMode
    timeoutMs: number
  },
): Promise<string> {
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
      frame: FRAME_AXIS_FREE_PROMPT_VERSION,
      evaluate: EVALUATE_RUBRIC_PROMPT_VERSION,
    },
    schemaVersion: SCHEMA_VERSION,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
    generationStrategy: 'JOINT_AXIS_FREE_V1',
    rubricVersion: RUBRIC_VERSION,
    dedupMode: null,
    degraded: false,
    attempts: [],
    errorCode: null,
    errorMessage: null,
    mockScenario: options.mockScenario ?? null,
    startedAt,
    finishedAt: null,
    progress: {
      stage: 'STARTED',
      facts: [],
      constraints: [],
      candidates: [],
    },
  })
  return runId
}

export async function executeInitial(
  connection: DatabaseConnection,
  options: {
    projectId: string
    runId: string
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

  const runId = options.runId
  const provider = createModelProvider(
    { MODEL_MODE: options.modelMode },
    { mockScenario: options.mockScenario },
  )
  let attempts: PipelineAttempt[] = []
  try {
    const pipeline = await generatePipeline({
      prompt: project.originalPrompt,
      provider,
      timeoutMs: options.timeoutMs,
      strategy: 'JOINT_AXIS_FREE_V1',
      onProgress: async (progress) => {
        try {
          await db
            .update(generationRuns)
            .set({ progress })
            .where(eq(generationRuns.id, runId))
        } catch {
          console.error('Unable to persist generation progress', {
            runId,
            stage: progress.stage,
          })
        }
      },
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
      origin: 'INITIAL_FRAME',
      operator: null,
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

export async function generateInitial(
  connection: DatabaseConnection,
  options: {
    projectId: string
    mockScenario?: MockScenario
    modelMode: ModelMode
    timeoutMs: number
  },
) {
  const runId = await beginInitial(connection, options)
  return executeInitial(connection, { ...options, runId })
}

export async function projectOperatorOptions(
  connection: DatabaseConnection,
  projectId: string,
  parentNodeId: string,
) {
  const { db } = connection
  const [parent] = await db
    .select()
    .from(nodes)
    .where(and(eq(nodes.id, parentNodeId), eq(nodes.projectId, projectId)))
    .limit(1)
  if (!parent) throw new GenerationServiceError('Node not found', 'NOT_FOUND')
  const [projectNodes, projectEdges] = await Promise.all([
    db.select().from(nodes).where(eq(nodes.projectId, projectId)),
    db.select().from(edges).where(eq(edges.projectId, projectId)),
  ])
  const context: ParentContext = {
    id: parent.id,
    type: parent.type,
    status: parent.status,
    operator: parent.operator,
    content: parent.content,
  }
  const graph = { nodes: projectNodes, edges: projectEdges }
  return getOperatorOptions({ parents: [context] }, () =>
    computePlanningFeatures(graph, parentNodeId),
  )
}

export async function expandNode(
  connection: DatabaseConnection,
  options: {
    projectId: string
    parentNodeId: string
    operator: UnaryOperator
    assumption?: string
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
  const [parent] = await db
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.id, options.parentNodeId),
        eq(nodes.projectId, options.projectId),
      ),
    )
    .limit(1)
  if (!parent) throw new GenerationServiceError('Node not found', 'NOT_FOUND')
  const [initialRun] = await db
    .select()
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.projectId, options.projectId),
        eq(generationRuns.kind, 'INITIAL'),
        eq(generationRuns.status, 'SUCCEEDED'),
      ),
    )
    .orderBy(desc(generationRuns.startedAt))
    .limit(1)
  if (!initialRun)
    throw new GenerationServiceError(
      'A successful initial generation is required',
      'BAD_REQUEST',
    )
  const parentContext: ParentContext = {
    id: parent.id,
    type: parent.type,
    status: parent.status,
    operator: parent.operator,
    content: parent.content,
  }
  const precondition = OPERATOR_REGISTRY[options.operator].precondition({
    parents: [parentContext],
    assumption: options.assumption,
  })
  if (!precondition.eligible)
    throw new GenerationServiceError(
      `${precondition.code}: ${precondition.reason ?? 'Operator is not eligible for this node'}`,
      'BAD_REQUEST',
    )
  const [projectNodes, projectEdges] = await Promise.all([
    db.select().from(nodes).where(eq(nodes.projectId, options.projectId)),
    db.select().from(edges).where(eq(edges.projectId, options.projectId)),
  ])
  const planningFeatures = computePlanningFeatures(
    { nodes: projectNodes, edges: projectEdges },
    parent.id,
  )
  const suitability =
    OPERATOR_REGISTRY[options.operator].suitability(planningFeatures)
  const analysis = await db
    .select()
    .from(promptAnalyses)
    .where(eq(promptAnalyses.runId, initialRun.id))
    .limit(1)
  const promptRows = analysis[0]
    ? await db
        .select()
        .from(promptItems)
        .where(eq(promptItems.analysisId, analysis[0].id))
    : []
  const facts = promptRows
    .filter((item) => item.kind === 'FACT')
    .map((item) => ({
      ref: item.ref,
      text: item.text,
      evidence: item.evidenceText,
    }))
  const constraints = promptRows
    .filter((item) => item.kind === 'CONSTRAINT')
    .map((item) => ({
      ref: item.ref,
      text: item.text,
      evidence: item.evidenceText,
      strength: item.strength as 'hard' | 'soft',
      basis: item.basis as 'explicit' | 'inferred',
    }))
  const trustedAssumption = options.assumption ?? precondition.assumptions[0]
  const provider = createModelProvider(
    { MODEL_MODE: options.modelMode },
    { mockScenario: options.mockScenario },
  )
  const runId = randomUUID()
  const startedAt = new Date()
  const planningMetadata = {
    version: PLANNING_FEATURES_VERSION,
    suitabilityVersion: SUITABILITY_VERSION,
    features: planningFeatures,
    suitability: suitability.score,
    adjustments: suitability.breakdown,
  }
  await db.insert(generationRuns).values({
    id: runId,
    projectId: options.projectId,
    kind: 'EXPANSION',
    status: 'RUNNING',
    modelProvider: provider.identity.provider,
    modelName: provider.identity.model,
    promptVersions: {
      evaluate: EVALUATE_RUBRIC_PROMPT_VERSION,
      expand: EXPAND_PROMPT_VERSION_V2,
    },
    operator: options.operator,
    parentNodeId: parent.id,
    operatorRegistryVersion: OPERATOR_REGISTRY_VERSION,
    planningFeatures: planningMetadata,
    schemaVersion: SCHEMA_VERSION,
    selectionPolicyVersion: EXPANSION_SELECTION_POLICY_VERSION,
    generationStrategy: null,
    rubricVersion: RUBRIC_VERSION,
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
    const existingChildren = await db
      .select({ node: nodes })
      .from(edges)
      .innerJoin(nodes, eq(nodes.id, edges.childId))
      .where(eq(edges.parentId, parent.id))
    const factIdByRef = new Map(
      promptRows
        .filter((item) => item.kind === 'FACT')
        .map((item) => [item.ref, item.id]),
    )
    const pipeline = await expandPipeline({
      operator: options.operator,
      parent: parent.content as IdeaContent,
      rootPrompt: project.originalPrompt,
      facts,
      factIds: factIdByRef,
      constraints,
      assumption: trustedAssumption,
      mechanism: String(parent.content.mechanism ?? ''),
      suitabilityScore: suitability.score,
      provider,
      timeoutMs: options.timeoutMs,
      existingChildren: existingChildren.map(({ node }) => ({
        id: node.id,
        title: node.title,
        summary: node.summary,
        mechanism: String((node.content as IdeaContent).mechanism ?? ''),
      })),
    })
    attempts = pipeline.attempts
    await db.transaction(async (tx) => {
      for (const candidate of pipeline.candidates) {
        await tx.insert(candidates).values({
          id: candidate.id,
          projectId: options.projectId,
          runId,
          ordinal: candidate.ordinal,
          modelKey: candidate.content.key,
          content: candidate.content,
          operator: options.operator,
          operatorRegistryVersion: OPERATOR_REGISTRY_VERSION,
          suitabilityScore: suitability.score,
          planningMetadata,
          constraintEvaluations: candidate.evaluation.constraints,
          quality: qualityForCandidate(candidate),
          generationMeta: candidate.generationMeta ?? null,
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
          selectionMetadata: {
            ...candidate.selectionMetadata,
            ...planningMetadata,
            duplicateOfNodeId:
              candidate.selectionMetadata.duplicateOfNodeId ?? null,
          },
          promptVersion: EXPAND_PROMPT_VERSION_V2,
          schemaVersion: SCHEMA_VERSION,
          policyVersion: EXPANSION_SELECTION_POLICY_VERSION,
          nodeId: null,
        })
        await tx.insert(hypotheses).values({
          id: randomUUID(),
          projectId: options.projectId,
          runId,
          candidateId: candidate.id,
          statement: candidate.content.hypothesis.statement,
          axes: candidate.content.hypothesis.axes ?? null,
          assumptions: candidate.content.hypothesis.assumptions,
          supportingFactIds:
            candidate.content.hypothesis.supportingFactRefs.flatMap((ref) =>
              factIdByRef.has(ref) ? [factIdByRef.get(ref)!] : [],
            ),
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
    const selected = pipeline.candidates
      .filter((candidate) => candidate.selectionState === 'SELECTED')
      .sort((left, right) => left.displayPosition! - right.displayPosition!)
    await applyGraphPatch(db, {
      projectId: options.projectId,
      runId,
      origin: 'OPERATOR_EXPANSION',
      operator: options.operator,
      ops: selected.map((candidate) => ({
        op: 'ADD_IDEA',
        candidateId: candidate.id,
        parentNodeIds: [parent.id],
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
    const message = error instanceof Error ? error.message : 'Expansion failed'
    if (error instanceof PipelineError) attempts = error.attempts
    else if (!attempts.length)
      attempts = [{ task: 'expand', ok: false, code, message }]
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
        nodeId: parent.id,
        type: 'GENERATION_FAILED',
        payload: {
          code,
          message,
          operator: options.operator,
          parentNodeId: parent.id,
        },
        dedupeKey: null,
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
        quality: qualityForCandidate(candidate),
        generationMeta: candidate.generationMeta ?? null,
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
        promptVersion:
          typeof candidate.generationMeta?.promptVersion === 'string'
            ? candidate.generationMeta.promptVersion
            : FRAME_AXIS_FREE_PROMPT_VERSION,
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
        axes: candidate.content.hypothesis.axes ?? null,
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
        generationStrategy: pipeline.strategy,
        rubricVersion: pipeline.rubricVersion,
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
    .where(
      and(
        eq(generationRuns.projectId, projectId),
        eq(generationRuns.kind, 'INITIAL'),
      ),
    )
    .orderBy(desc(generationRuns.startedAt))
    .limit(1)
  const [latestExpansionRun] = await db
    .select()
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.projectId, projectId),
        eq(generationRuns.kind, 'EXPANSION'),
      ),
    )
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
  const candidateRows = await db
    .select({ candidate: candidates })
    .from(candidates)
    .innerJoin(generationRuns, eq(generationRuns.id, candidates.runId))
    .where(eq(generationRuns.projectId, projectId))
    .orderBy(desc(generationRuns.startedAt), candidates.ordinal)
  const candidateIds = candidateRows.map(({ candidate }) => candidate.id)
  const hypothesisRows = candidateRows.length
    ? await db
        .select()
        .from(hypotheses)
        .where(inArray(hypotheses.candidateId, candidateIds))
    : []
  const constraintItems = new Map(
    items
      .filter((item) => item.kind === 'CONSTRAINT')
      .map((item) => [item.ref, item]),
  )
  const hypothesisByCandidateId = new Map(
    hypothesisRows.map((hypothesis) => [hypothesis.candidateId, hypothesis]),
  )
  const candidateDtos: CandidateDto[] = candidateRows.flatMap(
    ({ candidate }) => {
      const hypothesis = hypothesisByCandidateId.get(candidate.id)
      if (!hypothesis) return []
      const selectionMetadata = candidate.selectionMetadata as Record<
        string,
        unknown
      >
      return [
        {
          id: candidate.id,
          runId: candidate.runId,
          ordinal: candidate.ordinal,
          operator: candidate.operator,
          operatorRegistryVersion: candidate.operatorRegistryVersion,
          suitabilityScore: candidate.suitabilityScore,
          selectionScore: candidate.selectionScore,
          planningMetadata: candidate.planningMetadata,
          duplicateOfNodeId:
            typeof selectionMetadata.duplicateOfNodeId === 'string'
              ? selectionMetadata.duplicateOfNodeId
              : null,
          content: candidate.content,
          constraintEvaluations: candidate.constraintEvaluations.map(
            (result) => {
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
            },
          ),
          quality: candidate.quality,
          qualityScore: candidate.qualityScore,
          generationMeta: candidate.generationMeta,
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
    },
  )

  return {
    project: toProjectDto(project),
    nodes: projectNodes.map(toNodeDto),
    edges: projectEdges.map(toEdgeDto),
    latestRun: latestRun ? toRunDto(latestRun) : null,
    latestExpansionRun: latestExpansionRun
      ? toRunDto(latestExpansionRun)
      : null,
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
    activeNodeId: project.activeNodeId,
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
    status: node.status,
    userEdited: node.userEdited,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
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
    operator: run.operator,
    parentNodeId: run.parentNodeId,
    operatorRegistryVersion: run.operatorRegistryVersion,
    planningFeatures: run.planningFeatures,
    schemaVersion: run.schemaVersion,
    selectionPolicyVersion: run.selectionPolicyVersion,
    generationStrategy: run.generationStrategy,
    rubricVersion: run.rubricVersion,
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
