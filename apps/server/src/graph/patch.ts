import { and, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DatabaseConnection } from '../db/client'
import {
  candidates,
  edges,
  events,
  generationRuns,
  nodes,
  projects,
} from '../db/schema'

const AddIdeaOperationSchema = z
  .object({
    op: z.literal('ADD_IDEA'),
    candidateId: z.string().uuid(),
    parentNodeIds: z.array(z.string().uuid()).min(1),
    displayPosition: z.number().int().min(1).max(4),
  })
  .strict()

export const GraphPatchSchema = z
  .object({
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
    origin: z.enum(['INITIAL_FRAME', 'OPERATOR_EXPANSION']).optional(),
    operator: z
      .enum(['GROUND', 'REFRAME', 'LEAP', 'INVERT', 'TRANSPLANT'])
      .nullable()
      .optional(),
    ops: z.array(AddIdeaOperationSchema).max(4),
  })
  .strict()

export type GraphPatch = z.infer<typeof GraphPatchSchema>
export type GraphPatchFaultInjection = 'afterNodes'

export class GraphPatchError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_GRAPH_PATCH',
  ) {
    super(message)
    this.name = 'GraphPatchError'
  }
}

export async function applyGraphPatch(
  db: DatabaseConnection['db'],
  input: GraphPatch,
  opts: { faultInjection?: GraphPatchFaultInjection } = {},
) {
  const patch = GraphPatchSchema.parse(input)
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, patch.projectId))
      .limit(1)
      .for('update')
    if (!project) throw new GraphPatchError('Project does not exist')

    const [run] = await tx
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.id, patch.runId))
      .limit(1)
    if (!run || run.projectId !== patch.projectId || run.status !== 'RUNNING')
      throw new GraphPatchError('Run must be running in the target project')
    const expansion = run.kind === 'EXPANSION'
    if (expansion) {
      if (
        patch.origin !== 'OPERATOR_EXPANSION' ||
        patch.operator !== run.operator ||
        !run.parentNodeId ||
        patch.ops.length > 3
      )
        throw new GraphPatchError('Expansion patch does not match its run')
    } else {
      if (
        (patch.origin && patch.origin !== 'INITIAL_FRAME') ||
        (patch.operator ?? null) !== null ||
        patch.ops.length < 1
      )
        throw new GraphPatchError('Initial patch does not match its run')
      const [succeededInitialRun] = await tx
        .select({ id: generationRuns.id })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.projectId, patch.projectId),
            eq(generationRuns.kind, 'INITIAL'),
            eq(generationRuns.status, 'SUCCEEDED'),
          ),
        )
        .limit(1)
      if (succeededInitialRun)
        throw new GraphPatchError(
          'An initial generation has already succeeded',
          'INITIAL_ALREADY_GENERATED',
        )
    }

    const candidateIds = patch.ops.map((operation) => operation.candidateId)
    if (new Set(candidateIds).size !== candidateIds.length)
      throw new GraphPatchError('A candidate cannot be added more than once')

    const candidateRows = await tx
      .select()
      .from(candidates)
      .where(inArray(candidates.id, candidateIds))
    const candidateById = new Map(
      candidateRows.map((candidate) => [candidate.id, candidate]),
    )
    for (const candidateId of candidateIds) {
      const candidate = candidateById.get(candidateId)
      if (
        !candidate ||
        candidate.projectId !== patch.projectId ||
        candidate.runId !== patch.runId ||
        candidate.selectionState !== 'SELECTED' ||
        candidate.nodeId !== null
      ) {
        throw new GraphPatchError(
          'Candidate must be selected, unmaterialized, and owned by the run',
        )
      }
      if (
        candidate.content.title.length > 120 ||
        candidate.content.summary.length > 600
      )
        throw new GraphPatchError('Candidate content exceeds node limits')
      if (expansion && candidate.operator !== run.operator)
        throw new GraphPatchError('Candidate operator does not match the run')
    }

    const parentIds = [
      ...new Set([
        ...patch.ops.flatMap((operation) => operation.parentNodeIds),
        ...(expansion && run.parentNodeId ? [run.parentNodeId] : []),
      ]),
    ]
    const parentRows = await tx
      .select()
      .from(nodes)
      .where(inArray(nodes.id, parentIds))
      .for('update')
    const parentById = new Map(parentRows.map((node) => [node.id, node]))
    if (expansion) {
      const parent = parentById.get(run.parentNodeId!)
      if (
        !parent ||
        parent.projectId !== patch.projectId ||
        parent.type !== 'IDEA' ||
        parent.status === 'REJECTED' ||
        parent.status === 'ARCHIVED'
      )
        throw new GraphPatchError('Expansion parent is not eligible')
    }
    for (const operation of patch.ops) {
      if (operation.parentNodeIds.length !== 1)
        throw new GraphPatchError('Idea expansions require exactly one parent')
      if (expansion && operation.parentNodeIds[0] !== run.parentNodeId)
        throw new GraphPatchError('Expansion parent does not match the run')
      if (expansion) {
        const existingChildren = await tx
          .select({ title: nodes.title, summary: nodes.summary })
          .from(edges)
          .innerJoin(nodes, eq(nodes.id, edges.childId))
          .where(eq(edges.parentId, run.parentNodeId!))
        const candidate = candidateById.get(operation.candidateId)!
        if (
          existingChildren.some(
            (child) =>
              normalizeContent(child.title) ===
                normalizeContent(candidate.content.title) &&
              normalizeContent(child.summary) ===
                normalizeContent(candidate.content.summary),
          )
        )
          throw new GraphPatchError('Expansion duplicates an existing child')
      }
      for (const parentId of operation.parentNodeIds) {
        const parent = parentById.get(parentId)
        if (!parent || parent.projectId !== patch.projectId)
          throw new GraphPatchError(
            'Parent node must exist in the target project',
          )
        if (
          expansion &&
          (parent.type !== 'IDEA' ||
            parent.status === 'REJECTED' ||
            parent.status === 'ARCHIVED')
        )
          throw new GraphPatchError('Expansion parent is not eligible')
        if (operation.displayPosition > (expansion ? 3 : 4))
          throw new GraphPatchError('Display position exceeds the run limit')
      }
    }

    const existingEdges = await tx
      .select({ parentId: edges.parentId, childId: edges.childId })
      .from(edges)
      .where(eq(edges.projectId, patch.projectId))
    const edgeKeys = new Set(
      existingEdges.map((edge) => `${edge.parentId}:${edge.childId}`),
    )
    const newEdgeKeys = new Set<string>()
    const graphEdges = existingEdges.map(
      (edge) => [edge.parentId, edge.childId] as const,
    )
    const nodeIdsByCandidate = new Map<string, string>()
    for (const operation of patch.ops) {
      const nodeId = randomUUID()
      nodeIdsByCandidate.set(operation.candidateId, nodeId)
    }
    const newEdges = patch.ops.flatMap((operation) =>
      operation.parentNodeIds.map(
        (parentId) =>
          [parentId, nodeIdsByCandidate.get(operation.candidateId)!] as const,
      ),
    )
    for (const [parentId, childId] of newEdges) {
      const edgeKey = `${parentId}:${childId}`
      if (edgeKeys.has(edgeKey) || newEdgeKeys.has(edgeKey))
        throw new GraphPatchError('Patch contains a duplicate edge')
      newEdgeKeys.add(edgeKey)
    }
    if (newEdgeKeys.size !== newEdges.length)
      throw new GraphPatchError('Patch contains duplicate parent-child pairs')
    const allProjectNodes = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.projectId, patch.projectId))
    const nodeIds = new Set(allProjectNodes.map((node) => node.id))
    for (const nodeId of nodeIdsByCandidate.values()) nodeIds.add(nodeId)
    assertAcyclic([...graphEdges, ...newEdges], nodeIds)

    for (const operation of patch.ops) {
      const candidate = candidateById.get(operation.candidateId)!
      const nodeId = nodeIdsByCandidate.get(operation.candidateId)!
      await tx.insert(nodes).values({
        id: nodeId,
        projectId: patch.projectId,
        type: 'IDEA',
        origin: expansion ? 'OPERATOR_EXPANSION' : 'INITIAL_FRAME',
        operator: expansion ? run.operator : null,
        runId: patch.runId,
        candidateId: candidate.id,
        title: candidate.content.title,
        summary: candidate.content.summary,
        content: candidate.content,
        displayPosition: operation.displayPosition,
      })
    }
    if (opts.faultInjection === 'afterNodes') {
      throw new GraphPatchError(
        'Injected graph patch failure',
        'INJECTED_FAILURE',
      )
    }

    for (const operation of patch.ops) {
      const nodeId = nodeIdsByCandidate.get(operation.candidateId)!
      for (const parentId of operation.parentNodeIds) {
        await tx.insert(edges).values({
          id: randomUUID(),
          projectId: patch.projectId,
          parentId,
          childId: nodeId,
          runId: patch.runId,
        })
      }
      await tx
        .update(candidates)
        .set({ nodeId })
        .where(
          and(
            eq(candidates.id, operation.candidateId),
            isNull(candidates.nodeId),
          ),
        )
    }
    await tx
      .update(generationRuns)
      .set({ status: 'SUCCEEDED', finishedAt: new Date() })
      .where(eq(generationRuns.id, patch.runId))
    const timestamp = new Date()
    if (expansion) {
      await tx
        .update(projects)
        .set({ updatedAt: timestamp })
        .where(eq(projects.id, patch.projectId))
    }
    await tx.insert(events).values({
      id: randomUUID(),
      projectId: patch.projectId,
      runId: patch.runId,
      nodeId: expansion ? run.parentNodeId : null,
      type: expansion ? 'NODE_EXPANDED' : 'INITIAL_GENERATED',
      payload: {
        nodeIds: [...nodeIdsByCandidate.values()],
        candidateIds: patch.ops.map((operation) => operation.candidateId),
        ...(expansion
          ? {
              operator: run.operator,
              parentNodeId: run.parentNodeId,
              displayedCount: nodeIdsByCandidate.size,
            }
          : {}),
      },
      dedupeKey: null,
      createdAt: timestamp,
    })
    return {
      nodes: [...nodeIdsByCandidate.entries()].map(([candidateId, nodeId]) => ({
        candidateId,
        nodeId,
      })),
    }
  })
}

function assertAcyclic(
  graphEdges: readonly (readonly [string, string])[],
  nodeIds: Set<string>,
) {
  const children = new Map<string, string[]>()
  for (const [parentId, childId] of graphEdges) {
    children.set(parentId, [...(children.get(parentId) ?? []), childId])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return false
    if (visited.has(nodeId)) return true
    visiting.add(nodeId)
    for (const childId of children.get(nodeId) ?? []) {
      if (!visit(childId)) return false
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return true
  }
  for (const nodeId of nodeIds) {
    if (!visit(nodeId))
      throw new GraphPatchError('Graph patch would create a cycle')
  }
}

function normalizeContent(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
