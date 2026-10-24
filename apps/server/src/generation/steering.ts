import {
  EditableIdeaFieldsSchema,
  IdeaContentSchema,
  type EditableIdeaFields,
} from '@unfold/shared'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../db/client'
import { appendEvent } from '../db/event-repository'
import { edges, nodes, projects } from '../db/schema'

export class SteeringError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'BAD_REQUEST',
  ) {
    super(message)
    this.name = 'SteeringError'
  }
}

export type SteeringAction =
  'pin' | 'unpin' | 'reject' | 'archive' | 'setActive' | 'edit'

export async function steerNode(
  connection: DatabaseConnection,
  action: SteeringAction,
  input: { projectId: string; nodeId: string; fields?: unknown },
) {
  return connection.db.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for('update')
    if (!project) throw new SteeringError('Project not found', 'NOT_FOUND')
    const [node] = await tx
      .select()
      .from(nodes)
      .where(
        and(eq(nodes.id, input.nodeId), eq(nodes.projectId, input.projectId)),
      )
      .for('update')
    if (!node || node.type !== 'IDEA')
      throw new SteeringError('Idea node not found', 'NOT_FOUND')
    const timestamp = new Date()
    const event = async (
      type:
        | 'NODE_PINNED'
        | 'NODE_UNPINNED'
        | 'NODE_REJECTED'
        | 'NODE_ARCHIVED'
        | 'NODE_EDITED'
        | 'ACTIVE_NODE_CHANGED',
      payload: Record<string, unknown>,
      nodeId: string | null = node.id,
    ) =>
      appendEvent(tx, {
        id: randomUUID(),
        projectId: input.projectId,
        runId: null,
        nodeId,
        type,
        payload,
        dedupeKey: null,
        createdAt: timestamp,
      })
    if (action === 'pin' || action === 'unpin') {
      const expected = action === 'pin' ? 'VISIBLE' : 'PINNED'
      if (node.status !== expected)
        throw new SteeringError(
          `Only ${expected.toLowerCase()} nodes can be ${action}ned`,
          'BAD_REQUEST',
        )
      await tx
        .update(nodes)
        .set({
          status: action === 'pin' ? 'PINNED' : 'VISIBLE',
          updatedAt: timestamp,
        })
        .where(eq(nodes.id, node.id))
      await event(action === 'pin' ? 'NODE_PINNED' : 'NODE_UNPINNED', {})
      return { changed: true }
    }
    if (action === 'reject' || action === 'archive') {
      if (node.status !== 'VISIBLE' && node.status !== 'PINNED')
        throw new SteeringError(
          'Only visible or pinned nodes can change status',
          'BAD_REQUEST',
        )
      const nextStatus = action === 'reject' ? 'REJECTED' : 'ARCHIVED'
      await tx
        .update(nodes)
        .set({ status: nextStatus, updatedAt: timestamp })
        .where(eq(nodes.id, node.id))
      await event(action === 'reject' ? 'NODE_REJECTED' : 'NODE_ARCHIVED', {})
      if (project.activeNodeId === node.id) {
        const fallback = await nearestVisibleAncestor(
          tx,
          input.projectId,
          node.id,
        )
        await tx
          .update(projects)
          .set({ activeNodeId: fallback?.id ?? null, updatedAt: timestamp })
          .where(eq(projects.id, input.projectId))
        await event(
          'ACTIVE_NODE_CHANGED',
          {
            previousNodeId: node.id,
            nextNodeId: fallback?.id ?? null,
            reason: 'active_node_unavailable',
          },
          null,
        )
      }
      return { changed: true }
    }
    if (action === 'setActive') {
      if (node.status !== 'VISIBLE' && node.status !== 'PINNED')
        throw new SteeringError(
          'Only visible or pinned nodes can be active',
          'BAD_REQUEST',
        )
      if (project.activeNodeId === node.id) return { changed: false }
      await tx
        .update(projects)
        .set({ activeNodeId: node.id, updatedAt: timestamp })
        .where(eq(projects.id, input.projectId))
      await event(
        'ACTIVE_NODE_CHANGED',
        { previousNodeId: project.activeNodeId, nextNodeId: node.id },
        null,
      )
      return { changed: true }
    }
    if (node.status !== 'VISIBLE' && node.status !== 'PINNED')
      throw new SteeringError(
        'Only visible or pinned nodes can be edited',
        'BAD_REQUEST',
      )
    const fields = EditableIdeaFieldsSchema.parse(
      input.fields,
    ) as EditableIdeaFields
    const before = IdeaContentSchema.parse(node.content)
    const after = IdeaContentSchema.parse({ ...before, ...fields })
    const changedFields = Object.keys(fields).filter(
      (key) =>
        JSON.stringify(before[key as keyof typeof before]) !==
        JSON.stringify(after[key as keyof typeof after]),
    )
    if (!changedFields.length) return { changed: false }
    await tx
      .update(nodes)
      .set({
        content: after,
        title: after.title,
        summary: after.summary,
        userEdited: true,
        updatedAt: timestamp,
      })
      .where(eq(nodes.id, node.id))
    await event('NODE_EDITED', { changedFields })
    return { changed: true }
  })
}

async function nearestVisibleAncestor(
  tx: Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0],
  projectId: string,
  nodeId: string,
) {
  const [allNodes, allEdges] = await Promise.all([
    tx.select().from(nodes).where(eq(nodes.projectId, projectId)),
    tx.select().from(edges).where(eq(edges.projectId, projectId)),
  ])
  const byId = new Map(allNodes.map((item) => [item.id, item]))
  const parents = new Map<string, string[]>()
  for (const edge of allEdges)
    parents.set(edge.childId, [
      ...(parents.get(edge.childId) ?? []),
      edge.parentId,
    ])
  const visited = new Set([nodeId])
  let frontier = [nodeId]
  while (frontier.length) {
    const next: string[] = []
    const matches = frontier
      .flatMap((id) => parents.get(id) ?? [])
      .map((id) => byId.get(id))
      .filter(
        (item): item is (typeof allNodes)[number] =>
          item !== undefined &&
          item?.type === 'IDEA' &&
          (item.status === 'VISIBLE' || item.status === 'PINNED'),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      )
    if (matches[0]) return matches[0]
    for (const parentId of frontier.flatMap((id) => parents.get(id) ?? [])) {
      if (!visited.has(parentId)) {
        visited.add(parentId)
        next.push(parentId)
      }
    }
    frontier = next
  }
  return null
}
