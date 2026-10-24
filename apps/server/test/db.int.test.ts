import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../src/db/client'
import {
  appMeta,
  candidates,
  edges,
  generationRuns,
  nodes,
} from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import { appRouter } from '../src/trpc/router'
import { createContext } from '../src/trpc/context'
import { applyGraphPatch, GraphPatchError } from '../src/graph/patch'

const databaseUrl =
  process.env.DATABASE_URL_TEST ??
  'mysql://unfold:unfold@localhost:3306/unfold_test'

describe('MySQL integration', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl)
  })

  afterAll(async () => {
    await closeDatabase(databaseUrl)
  })

  it('applies migrations idempotently and creates app_meta', async () => {
    await runMigrations(databaseUrl)
    const { db } = getDatabase(databaseUrl)
    const result = await db.select().from(appMeta).limit(1)
    expect(result).toBeDefined()
  })

  it('inserts and reads app metadata', async () => {
    const { db } = getDatabase(databaseUrl)
    await db
      .insert(appMeta)
      .values({ key: 'integration-test', value: 'roundtrip' })
      .onDuplicateKeyUpdate({ set: { value: 'roundtrip' } })

    const [row] = await db
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, 'integration-test'))
    expect(row?.value).toBe('roundtrip')
  })

  it('reports applied migrations through health.db', async () => {
    const result = await appRouter
      .createCaller(createContext(databaseUrl))
      .health.db()
    expect(result.status).toBe('ok')
    expect(result.migrationsApplied).toBeGreaterThanOrEqual(1)
  })

  it('persists a selected prompt graph and rolls back a failed graph patch', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt:
        'I want to test whether my neighborhood can support a bakery that helps busy families.',
    })
    expect(created.status).toBe('SUCCEEDED')

    const project = await caller.projects.get({ id: created.projectId })
    const root = project.nodes.find((node) => node.type === 'ROOT_PROMPT')
    const selected = project.candidates
      .filter((candidate) => candidate.selectionState === 'SELECTED')
      .sort((left, right) => left.displayPosition! - right.displayPosition!)
    expect(root).toBeDefined()
    expect(selected).toHaveLength(4)
    expect(project.nodes).toHaveLength(5)
    expect(project.edges).toHaveLength(4)
    expect(project.latestRun).toMatchObject({
      status: 'SUCCEEDED',
      schemaVersion: 'stage1-v1',
      selectionPolicyVersion: 'initial-mmr-v1',
    })

    const axes = selected.map((candidate) => candidate.hypothesis.axes)
    for (let left = 0; left < axes.length; left += 1) {
      for (let right = left + 1; right < axes.length; right += 1) {
        const sharedAxes = Object.keys(axes[left]!).filter(
          (axis) =>
            axes[left]![axis as keyof (typeof axes)[number]] ===
            axes[right]![axis as keyof (typeof axes)[number]],
        )
        expect(
          Object.keys(axes[left]!).length - sharedAxes.length,
        ).toBeGreaterThanOrEqual(2)
      }
    }

    const { db, pool } = getDatabase(databaseUrl)
    const projectEvents = await caller.events.list({
      projectId: created.projectId,
    })
    const eventCount = projectEvents.length
    const runId = project.latestRun!.id
    await db.transaction(async (tx) => {
      await tx.delete(edges).where(eq(edges.projectId, created.projectId))
      await tx
        .delete(nodes)
        .where(
          and(eq(nodes.projectId, created.projectId), eq(nodes.type, 'IDEA')),
        )
      await tx
        .update(candidates)
        .set({ nodeId: null })
        .where(eq(candidates.runId, runId))
      await tx
        .update(generationRuns)
        .set({ status: 'RUNNING', finishedAt: null })
        .where(eq(generationRuns.id, runId))
    })

    await expect(
      applyGraphPatch(
        db,
        {
          projectId: created.projectId,
          runId,
          ops: selected.map((candidate) => ({
            op: 'ADD_IDEA' as const,
            candidateId: candidate.id,
            parentNodeIds: [root!.id],
            displayPosition: candidate.displayPosition!,
          })),
        },
        { faultInjection: 'afterNodes' },
      ),
    ).rejects.toBeInstanceOf(GraphPatchError)

    const graphNodes = await db
      .select()
      .from(nodes)
      .where(eq(nodes.projectId, created.projectId))
    const graphEdges = await db
      .select()
      .from(edges)
      .where(eq(edges.projectId, created.projectId))
    const eventsAfterFailure = await caller.events.list({
      projectId: created.projectId,
    })
    expect(graphNodes).toHaveLength(1)
    expect(graphNodes[0]?.type).toBe('ROOT_PROMPT')
    expect(graphEdges).toHaveLength(0)
    expect(eventsAfterFailure).toHaveLength(eventCount)
    await expect(
      pool.query('UPDATE events SET payload = JSON_OBJECT() WHERE id = ?', [
        eventsAfterFailure[0]!.id,
      ]),
    ).rejects.toThrow()
    await expect(
      pool.query('DELETE FROM events WHERE id = ?', [
        eventsAfterFailure[0]!.id,
      ]),
    ).rejects.toThrow()
  })

  it('persists a failed mock run without adding idea nodes', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt: 'I want to test a neighborhood bakery.',
      mockScenario: 'provider-error',
    })
    const project = await caller.projects.get({ id: created.projectId })
    const projectEvents = await caller.events.list({
      projectId: created.projectId,
    })

    expect(created.status).toBe('FAILED')
    expect(project.latestRun).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_ERROR',
      mockScenario: 'provider-error',
    })
    expect(project.nodes.map((node) => node.type)).toEqual(['ROOT_PROMPT'])
    expect(project.edges).toHaveLength(0)
    expect(projectEvents.map((event) => event.type)).toContain(
      'GENERATION_FAILED',
    )
  })
})
