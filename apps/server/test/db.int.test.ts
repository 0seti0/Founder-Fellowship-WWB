import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../src/db/client'
import {
  appMeta,
  candidates,
  edges,
  generationRuns,
  hypotheses,
  nodes,
  promptItems,
} from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import { appRouter } from '../src/trpc/router'
import { createContext } from '../src/trpc/context'
import { applyGraphPatch, GraphPatchError } from '../src/graph/patch'
import { IdeaContentSchema } from '@unfold/shared'

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
      selectionPolicyVersion: 'initial-mmr-v2',
    })

    const { db, pool } = getDatabase(databaseUrl)
    const persistedSelected = (
      await db
        .select({
          displayPosition: candidates.displayPosition,
          selectionState: candidates.selectionState,
          selectionMetadata: candidates.selectionMetadata,
        })
        .from(candidates)
        .where(eq(candidates.runId, project.latestRun!.id))
    )
      .filter((candidate) => candidate.selectionState === 'SELECTED')
      .sort((left, right) => left.displayPosition! - right.displayPosition!)
    expect(persistedSelected).toHaveLength(4)
    for (const candidate of persistedSelected) {
      const components = candidate.selectionMetadata.components as
        Record<string, unknown> | undefined
      const axisCoverageBonus = components?.axisCoverageBonus
      expect(typeof axisCoverageBonus).toBe('number')
      expect(axisCoverageBonus as number).toBeGreaterThanOrEqual(0)
      expect(axisCoverageBonus as number).toBeLessThanOrEqual(0.04)
      if (candidate.displayPosition === 1) {
        expect(axisCoverageBonus).toBe(0)
      }
    }

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

  it('expands an idea and persists steering state and edits', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt: 'I want to test a neighborhood bakery.',
    })
    const initial = await caller.projects.get({ id: created.projectId })
    const parent = initial.nodes.find((node) => node.type === 'IDEA')!
    const options = await caller.nodes.operatorOptions({
      projectId: created.projectId,
      parentNodeId: parent.id,
    })
    expect(options.map((option) => option.operator)).toEqual([
      'GROUND',
      'REFRAME',
      'LEAP',
      'INVERT',
      'TRANSPLANT',
    ])

    const expanded = await caller.projects.expand({
      projectId: created.projectId,
      parentNodeId: parent.id,
      operator: 'GROUND',
    })
    expect(expanded.status).toBe('SUCCEEDED')
    const project = await caller.projects.get({ id: created.projectId })
    const originalEdges = project.edges
    const expansionRun = project.latestExpansionRun!
    expect(expansionRun.kind).toBe('EXPANSION')
    expect(expansionRun.operator).toBe('GROUND')
    const child = project.nodes.find((node) => node.runId === expansionRun.id)!
    expect(child.operator).toBe('GROUND')
    expect(child.status).toBe('VISIBLE')

    const originalCandidate = project.candidates.find(
      (candidate) => candidate.id === child.candidateId,
    )
    await caller.nodes.pin({ projectId: created.projectId, nodeId: child.id })
    await caller.nodes.unpin({ projectId: created.projectId, nodeId: child.id })
    await caller.nodes.pin({ projectId: created.projectId, nodeId: child.id })
    const pinned = await caller.projects.get({ id: created.projectId })
    expect(pinned.nodes.find((node) => node.id === child.id)?.status).toBe(
      'PINNED',
    )
    const content = IdeaContentSchema.parse(child.content)
    await caller.nodes.edit({
      projectId: created.projectId,
      nodeId: child.id,
      fields: {
        title: 'Edited operator direction',
        summary: content.summary,
        preservedIntent: content.preservedIntent,
        changedAssumptions: content.changedAssumptions,
        fitRationale: content.fitRationale,
        strongestObjection: content.strongestObjection,
        firstTest: content.firstTest,
        mechanism: content.mechanism,
        facets: content.facets,
      },
    })
    const edited = await caller.projects.get({ id: created.projectId })
    expect(edited.nodes.find((node) => node.id === child.id)).toMatchObject({
      title: 'Edited operator direction',
      userEdited: true,
    })
    expect(
      edited.candidates.find((candidate) => candidate.id === child.candidateId),
    ).toEqual(originalCandidate)
    expect(edited.edges).toEqual(originalEdges)
    await caller.nodes.setActive({
      projectId: created.projectId,
      nodeId: child.id,
    })
    await caller.nodes.reject({
      projectId: created.projectId,
      nodeId: child.id,
    })
    const rejected = await caller.projects.get({ id: created.projectId })
    expect(rejected.nodes.find((node) => node.id === child.id)?.status).toBe(
      'REJECTED',
    )
    expect(rejected.project.activeNodeId).toBe(parent.id)
    const eventsAfterSteering = await caller.events.list({
      projectId: created.projectId,
    })
    expect(eventsAfterSteering.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'NODE_PINNED',
        'NODE_EDITED',
        'ACTIVE_NODE_CHANGED',
        'NODE_REJECTED',
      ]),
    )
    expect(
      eventsAfterSteering.find((event) => event.type === 'NODE_EDITED')
        ?.payload,
    ).toEqual({
      changes: {
        title: {
          from: content.title,
          to: 'Edited operator direction',
        },
      },
    })
    expect(
      eventsAfterSteering.find((event) => event.type === 'NODE_REJECTED')
        ?.payload,
    ).toMatchObject({ previousStatus: 'PINNED' })
    await caller.nodes.setActive({
      projectId: created.projectId,
      nodeId: parent.id,
    })
    await caller.nodes.reject({
      projectId: created.projectId,
      nodeId: parent.id,
    })
    const clearedActive = await caller.projects.get({ id: created.projectId })
    expect(clearedActive.project.activeNodeId).toBeNull()
    const archivable = initial.nodes.find(
      (node) => node.type === 'IDEA' && node.id !== parent.id,
    )!
    await caller.nodes.archive({
      projectId: created.projectId,
      nodeId: archivable.id,
    })
    const eventsAfterArchive = await caller.events.list({
      projectId: created.projectId,
    })
    expect(
      eventsAfterArchive.find((event) => event.type === 'NODE_ARCHIVED')
        ?.payload,
    ).toMatchObject({ previousStatus: 'VISIBLE' })
    const expandedEvent = eventsAfterArchive.find(
      (event) => event.type === 'NODE_EXPANDED',
    )
    expect(expandedEvent?.nodeId).toBe(parent.id)
    expect(expandedEvent?.payload).toMatchObject({
      displayedCount: expect.any(Number),
    })
  })

  it.each(['GROUND', 'REFRAME', 'LEAP', 'INVERT', 'TRANSPLANT'] as const)(
    'persists all expansion metadata and one-parent lineage for %s',
    async (operator) => {
      const caller = appRouter.createCaller(createContext(databaseUrl))
      const created = await caller.projects.create({
        prompt: 'I want to test a neighborhood bakery.',
      })
      const initial = await caller.projects.get({ id: created.projectId })
      const parent = initial.nodes.find((node) => node.type === 'IDEA')!
      const operatorOptions = await caller.nodes.operatorOptions({
        projectId: created.projectId,
        parentNodeId: parent.id,
      })
      const assumption = operatorOptions.find(
        (option) => option.operator === 'INVERT',
      )?.assumptions[0]
      const result = await caller.projects.expand({
        projectId: created.projectId,
        parentNodeId: parent.id,
        operator,
        ...(operator === 'INVERT' && assumption ? { assumption } : {}),
      })
      expect(result.status).toBe('SUCCEEDED')
      const project = await caller.projects.get({ id: created.projectId })
      const run = project.latestExpansionRun!
      const runCandidates = project.candidates.filter(
        (candidate) => candidate.runId === run.id,
      )
      const selected = runCandidates.filter(
        (candidate) => candidate.selectionState === 'SELECTED',
      )
      const createdNodes = project.nodes.filter((node) => node.runId === run.id)
      const createdEdges = project.edges.filter((edge) => edge.runId === run.id)

      expect(run.operator).toBe(operator)
      expect(run.operatorRegistryVersion).toBe('operators-v1')
      expect(run.promptVersions.expand).toBe('expand-v1')
      expect(run.promptVersions.evaluate).toBe('evaluate-v1')
      expect(run.schemaVersion).toBe('expand-v1')
      expect(run.selectionPolicyVersion).toBe('expansion-mmr-v1')
      expect(runCandidates).toHaveLength(6)
      expect(selected.length).toBeGreaterThanOrEqual(1)
      expect(selected.length).toBeLessThanOrEqual(3)
      expect(
        selected.every((candidate) => candidate.operator === operator),
      ).toBe(true)
      const { db } = getDatabase(databaseUrl)
      const persisted = await db
        .select()
        .from(candidates)
        .where(eq(candidates.runId, run.id))
      expect(persisted).toHaveLength(6)
      expect(
        persisted.every(
          (candidate) =>
            typeof candidate.qualityScore === 'number' &&
            Array.isArray(candidate.rejectionReasons) &&
            candidate.selectionState !== null &&
            candidate.selectionMetadata !== null &&
            candidate.planningMetadata !== null &&
            candidate.operatorRegistryVersion === 'operators-v1',
        ),
      ).toBe(true)
      expect(
        selected.every(
          (candidate) =>
            candidate.displayPosition !== null &&
            typeof candidate.selectionScore === 'number' &&
            candidate.planningMetadata !== null,
        ),
      ).toBe(true)
      expect(createdNodes.length).toBe(selected.length)
      expect(createdEdges).toHaveLength(selected.length)
      expect(createdEdges.every((edge) => edge.parentId === parent.id)).toBe(
        true,
      )
      expect(createdNodes.every((node) => node.operator === operator)).toBe(
        true,
      )
      for (const candidate of persisted.filter(
        (item) => item.selectionState === 'SELECTED',
      )) {
        const components = candidate.selectionMetadata.components as
          Record<string, unknown> | undefined
        expect(typeof components?.axisCoverageBonus).toBe('number')
        expect(components!.axisCoverageBonus as number).toBeGreaterThanOrEqual(
          0,
        )
        expect(components!.axisCoverageBonus as number).toBeLessThanOrEqual(
          0.04,
        )
      }
      const persistedHypotheses = await db
        .select()
        .from(hypotheses)
        .where(eq(hypotheses.runId, run.id))
      const promptItemIds = new Set(
        (await db.select({ id: promptItems.id }).from(promptItems)).map(
          (item) => item.id,
        ),
      )
      const supportingFactIds = persistedHypotheses.flatMap(
        (hypothesis) => hypothesis.supportingFactIds,
      )
      expect(supportingFactIds.length).toBeGreaterThan(0)
      expect(supportingFactIds.every((id) => promptItemIds.has(id))).toBe(true)
      const expandedEvent = (
        await caller.events.list({
          projectId: created.projectId,
        })
      ).find((event) => event.type === 'NODE_EXPANDED')
      expect(expandedEvent?.nodeId).toBe(parent.id)
      expect(expandedEvent?.payload).toMatchObject({
        displayedCount: createdNodes.length,
      })
    },
  )

  it('rejects an expansion that duplicates an existing child', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt: 'I want to test a neighborhood bakery.',
    })
    const initial = await caller.projects.get({ id: created.projectId })
    const parent = initial.nodes.find((node) => node.type === 'IDEA')!
    await caller.projects.expand({
      projectId: created.projectId,
      parentNodeId: parent.id,
      operator: 'GROUND',
    })
    const project = await caller.projects.get({ id: created.projectId })
    const run = project.latestExpansionRun!
    const child = project.nodes.find((node) => node.runId === run.id)!
    const candidate = project.candidates.find(
      (item) => item.id === child.candidateId,
    )!
    const { db } = getDatabase(databaseUrl)
    await db
      .update(candidates)
      .set({ nodeId: null })
      .where(eq(candidates.id, candidate.id))
    await db
      .update(generationRuns)
      .set({ status: 'RUNNING', finishedAt: null })
      .where(eq(generationRuns.id, run.id))

    await expect(
      applyGraphPatch(db, {
        projectId: created.projectId,
        runId: run.id,
        origin: 'OPERATOR_EXPANSION',
        operator: 'GROUND',
        ops: [
          {
            op: 'ADD_IDEA',
            candidateId: candidate.id,
            parentNodeIds: [parent.id],
            displayPosition: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: 'Expansion duplicates an existing child',
    })
    const after = await caller.projects.get({ id: created.projectId })
    expect(after.nodes).toHaveLength(project.nodes.length)
    expect(after.edges).toHaveLength(project.edges.length)
  })

  it('rolls back invalid expansion patches and after-node fault injection', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt: 'I want to test a neighborhood bakery.',
    })
    const initial = await caller.projects.get({ id: created.projectId })
    const parent = initial.nodes.find((node) => node.type === 'IDEA')!
    const otherParent = initial.nodes.find(
      (node) => node.type === 'IDEA' && node.id !== parent.id,
    )!
    await caller.projects.expand({
      projectId: created.projectId,
      parentNodeId: parent.id,
      operator: 'GROUND',
    })
    const expanded = await caller.projects.get({ id: created.projectId })
    const run = expanded.latestExpansionRun!
    const runCandidates = expanded.candidates.filter(
      (candidate) => candidate.runId === run.id,
    )
    const selected = runCandidates.find(
      (candidate) => candidate.selectionState === 'SELECTED',
    )!
    const unselected = runCandidates.find(
      (candidate) => candidate.selectionState !== 'SELECTED',
    )!
    const { db } = getDatabase(databaseUrl)
    await db.transaction(async (tx) => {
      await tx.delete(edges).where(eq(edges.runId, run.id))
      await tx.delete(nodes).where(eq(nodes.runId, run.id))
      await tx
        .update(candidates)
        .set({ nodeId: null })
        .where(eq(candidates.runId, run.id))
      await tx
        .update(generationRuns)
        .set({ status: 'RUNNING', finishedAt: null })
        .where(eq(generationRuns.id, run.id))
    })
    const baselineNodes = initial.nodes.map((node) => node.id).sort()
    const baselineEdges = initial.edges.map((edge) => edge.id).sort()
    const operation = {
      op: 'ADD_IDEA' as const,
      candidateId: selected.id,
      parentNodeIds: [parent.id],
      displayPosition: 1,
    }
    const patch = (
      ops = [operation],
      operator: 'GROUND' | 'LEAP' = 'GROUND',
    ) => ({
      projectId: created.projectId,
      runId: run.id,
      origin: 'OPERATOR_EXPANSION' as const,
      operator,
      ops,
    })
    const assertUnchanged = async () => {
      const current = await caller.projects.get({ id: created.projectId })
      expect(current.nodes.map((node) => node.id).sort()).toEqual(baselineNodes)
      expect(current.edges.map((edge) => edge.id).sort()).toEqual(baselineEdges)
    }
    const invalidPatches = [
      patch([operation], 'LEAP'),
      patch([{ ...operation, candidateId: unselected.id }]),
      patch([operation, { ...operation, displayPosition: 2 }]),
      patch([{ ...operation, parentNodeIds: [otherParent.id] }]),
      patch([{ ...operation, parentNodeIds: [parent.id, otherParent.id] }]),
    ]
    for (const invalid of invalidPatches) {
      await expect(applyGraphPatch(db, invalid)).rejects.toBeInstanceOf(
        GraphPatchError,
      )
      await assertUnchanged()
    }
    await db
      .update(candidates)
      .set({ operator: 'LEAP' })
      .where(eq(candidates.id, selected.id))
    await expect(applyGraphPatch(db, patch())).rejects.toBeInstanceOf(
      GraphPatchError,
    )
    await db
      .update(candidates)
      .set({ operator: 'GROUND' })
      .where(eq(candidates.id, selected.id))
    await assertUnchanged()
    await db
      .update(nodes)
      .set({ status: 'REJECTED' })
      .where(eq(nodes.id, parent.id))
    await expect(applyGraphPatch(db, patch())).rejects.toBeInstanceOf(
      GraphPatchError,
    )
    await assertUnchanged()
    await db
      .update(nodes)
      .set({ status: 'VISIBLE' })
      .where(eq(nodes.id, parent.id))
    await expect(
      applyGraphPatch(db, patch(), { faultInjection: 'afterNodes' }),
    ).rejects.toBeInstanceOf(GraphPatchError)
    await assertUnchanged()
  })

  it('records a mismatched operator expansion as failed without graph changes', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt: 'I want to test a neighborhood bakery.',
    })
    const initial = await caller.projects.get({ id: created.projectId })
    const parent = initial.nodes.find((node) => node.type === 'IDEA')!
    const beforeNodeCount = initial.nodes.length
    const failed = await caller.projects.expand({
      projectId: created.projectId,
      parentNodeId: parent.id,
      operator: 'GROUND',
      mockScenario: 'operator-mismatch',
    })
    expect(failed.status).toBe('FAILED')
    const project = await caller.projects.get({ id: created.projectId })
    expect(project.nodes).toHaveLength(beforeNodeCount)
    expect(project.latestExpansionRun).toMatchObject({
      status: 'FAILED',
      errorCode: 'OPERATOR_MISMATCH',
      operator: 'GROUND',
      parentNodeId: parent.id,
    })
    const eventList = await caller.events.list({
      projectId: created.projectId,
    })
    expect(eventList.at(-1)).toMatchObject({
      type: 'GENERATION_FAILED',
      nodeId: parent.id,
      payload: {
        operator: 'GROUND',
        parentNodeId: parent.id,
      },
    })
  })

  it.each(['malformed', 'provider-error', 'timeout'] as const)(
    'leaves graph sets unchanged after %s expansion failure',
    async (mockScenario) => {
      const caller = appRouter.createCaller(createContext(databaseUrl))
      const created = await caller.projects.create({
        prompt: 'I want to test a neighborhood bakery.',
      })
      const initial = await caller.projects.get({ id: created.projectId })
      const parent = initial.nodes.find((node) => node.type === 'IDEA')!
      const beforeNodes = initial.nodes.map((node) => node.id).sort()
      const beforeEdges = initial.edges.map((edge) => edge.id).sort()
      const failed = await caller.projects.expand({
        projectId: created.projectId,
        parentNodeId: parent.id,
        operator: 'GROUND',
        mockScenario,
      })
      expect(failed.status).toBe('FAILED')
      const after = await caller.projects.get({ id: created.projectId })
      expect(after.nodes.map((node) => node.id).sort()).toEqual(beforeNodes)
      expect(after.edges.map((edge) => edge.id).sort()).toEqual(beforeEdges)
      expect(after.latestExpansionRun?.status).toBe('FAILED')
    },
    45_000,
  )

  it('rejects preconditions before creating an expansion run', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const created = await caller.projects.create({
      prompt: 'I want to test a neighborhood bakery.',
    })
    const initial = await caller.projects.get({ id: created.projectId })
    const root = initial.nodes.find((node) => node.type === 'ROOT_PROMPT')!
    const { db } = getDatabase(databaseUrl)
    const before = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.projectId, created.projectId))
    await expect(
      caller.projects.expand({
        projectId: created.projectId,
        parentNodeId: root.id,
        operator: 'GROUND',
      }),
    ).rejects.toThrow(/^ROOT_NOT_EXPANDABLE: /)
    const after = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.projectId, created.projectId))
    expect(after).toHaveLength(before.length)
  })

  it('stores long prompts in full while bounding the root summary', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const longPrompt = `I want to open a bakery. ${'x'.repeat(2975)}`
    expect(longPrompt).toHaveLength(3000)

    const created = await caller.projects.create({ prompt: longPrompt })
    expect(created.status).toBe('SUCCEEDED')

    const project = await caller.projects.get({ id: created.projectId })
    const root = project.nodes.find((node) => node.type === 'ROOT_PROMPT')
    expect(project.project.originalPrompt).toBe(longPrompt)
    expect(root?.summary).toBe(longPrompt.slice(0, 600))
    expect(root?.content).toEqual({ prompt: longPrompt })
    expect(project.project.title.length).toBeLessThanOrEqual(191)
  })

  it('allows only one concurrent initial generation to materialize ideas', async () => {
    const caller = appRouter.createCaller(createContext(databaseUrl))
    const failed = await caller.projects.create({
      prompt: 'I want to open a bakery.',
      mockScenario: 'provider-error',
    })
    expect(failed.status).toBe('FAILED')

    const results = await Promise.all([
      caller.projects.generateInitial({ projectId: failed.projectId }),
      caller.projects.generateInitial({ projectId: failed.projectId }),
    ])
    expect(
      results.filter((result) => result.status === 'SUCCEEDED'),
    ).toHaveLength(1)
    expect(
      results.filter(
        (result) =>
          result.status === 'FAILED' &&
          result.errorCode === 'INITIAL_ALREADY_GENERATED',
      ),
    ).toHaveLength(1)

    const { db } = getDatabase(databaseUrl)
    const runs = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.projectId, failed.projectId))
    const succeededRuns = runs.filter(
      (run) => run.kind === 'INITIAL' && run.status === 'SUCCEEDED',
    )
    const losingRuns = runs.filter(
      (run) => run.errorCode === 'INITIAL_ALREADY_GENERATED',
    )
    expect(succeededRuns).toHaveLength(1)
    expect(losingRuns).toHaveLength(1)
    expect(losingRuns[0]?.status).toBe('FAILED')

    const ideaNodes = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.projectId, failed.projectId), eq(nodes.type, 'IDEA')))
    expect(ideaNodes).toHaveLength(4)
    expect(ideaNodes.every((node) => node.runId === succeededRuns[0]?.id)).toBe(
      true,
    )

    const projectEvents = await caller.events.list({
      projectId: failed.projectId,
    })
    expect(
      projectEvents.some(
        (event) =>
          event.type === 'GENERATION_FAILED' &&
          (event.payload as { code?: string }).code ===
            'INITIAL_ALREADY_GENERATED',
      ),
    ).toBe(true)
  })
})
