import { initTRPC, TRPCError } from '@trpc/server'
import {
  CandidateDtoSchema,
  DbHealthSchema,
  GenerationEventSchema,
  GenerationRunSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  HealthStatusSchema,
  MockScenarioSchema,
  ProjectSchema,
  PromptItemSchema,
} from '@unfold/shared'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { env } from '../env'
import { appendEvent, listEvents } from '../db/event-repository'
import { events, generationRuns, nodes } from '../db/schema'
import {
  createProject,
  generateInitial,
  GenerationServiceError,
  getProject,
  listProjects,
} from '../generation/service'
import { createContext } from './context'

const t = initTRPC.context<ReturnType<typeof createContext>>().create()

const ProjectCreateResultSchema = z
  .object({
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
    status: z.enum(['SUCCEEDED', 'FAILED']),
    errorCode: z.string().nullable(),
  })
  .strict()

const ProjectGetSchema = z
  .object({
    project: ProjectSchema,
    nodes: z.array(GraphNodeSchema),
    edges: z.array(GraphEdgeSchema),
    latestRun: GenerationRunSchema.nullable(),
    analysis: z
      .object({
        facts: z.array(PromptItemSchema),
        constraints: z.array(PromptItemSchema),
      })
      .strict(),
    candidates: z.array(CandidateDtoSchema),
  })
  .strict()

const EventInputSchema = z.object({ projectId: z.string().uuid() }).strict()

export const appRouter = t.router({
  health: t.router({
    ping: t.procedure.output(HealthStatusSchema).query(() => ({
      status: 'ok' as const,
      service: 'unfold-server' as const,
      modelMode: env.MODEL_MODE,
      time: new Date().toISOString(),
    })),
    db: t.procedure.output(DbHealthSchema).query(async ({ ctx }) => {
      const { pool } = ctx.getDatabase()
      await pool.query('SELECT 1')
      const [rows] = await pool.query<
        (import('mysql2').RowDataPacket & { count: number | string })[]
      >('SELECT COUNT(*) AS count FROM `__drizzle_migrations`')
      return {
        status: 'ok' as const,
        migrationsApplied: Number(rows[0]?.count ?? 0),
      }
    }),
  }),
  projects: t.router({
    create: t.procedure
      .input(
        z
          .object({
            prompt: z.string().trim().min(1).max(4000),
            mockScenario: MockScenarioSchema.optional(),
          })
          .strict(),
      )
      .output(ProjectCreateResultSchema)
      .mutation(async ({ ctx, input }) => {
        if (input.mockScenario && env.MODEL_MODE !== 'mock') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Mock scenarios are only available in mock mode',
          })
        }
        return createProject(ctx.getDatabase(), {
          ...input,
          modelMode: env.MODEL_MODE,
          timeoutMs: env.MODEL_TIMEOUT_MS,
        })
      }),
    generateInitial: t.procedure
      .input(
        z
          .object({
            projectId: z.string().uuid(),
            mockScenario: MockScenarioSchema.optional(),
          })
          .strict(),
      )
      .output(ProjectCreateResultSchema)
      .mutation(async ({ ctx, input }) => {
        if (input.mockScenario && env.MODEL_MODE !== 'mock') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Mock scenarios are only available in mock mode',
          })
        }
        try {
          return {
            projectId: input.projectId,
            ...(await generateInitial(ctx.getDatabase(), {
              ...input,
              modelMode: env.MODEL_MODE,
              timeoutMs: env.MODEL_TIMEOUT_MS,
            })),
          }
        } catch (error) {
          throwServiceError(error)
        }
      }),
    list: t.procedure
      .output(z.array(ProjectSchema))
      .query(({ ctx }) => listProjects(ctx.getDatabase())),
    get: t.procedure
      .input(z.object({ id: z.string().uuid() }).strict())
      .output(ProjectGetSchema)
      .query(async ({ ctx, input }) => {
        try {
          return await getProject(ctx.getDatabase(), input.id)
        } catch (error) {
          throwServiceError(error)
        }
      }),
  }),
  events: t.router({
    slateDisplayed: t.procedure
      .input(
        z
          .object({
            projectId: z.string().uuid(),
            runId: z.string().uuid(),
          })
          .strict(),
      )
      .output(z.object({ recorded: z.boolean() }).strict())
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx.getDatabase()
        const [run] = await db
          .select({ id: generationRuns.id })
          .from(generationRuns)
          .where(
            and(
              eq(generationRuns.id, input.runId),
              eq(generationRuns.projectId, input.projectId),
              eq(generationRuns.status, 'SUCCEEDED'),
            ),
          )
          .limit(1)
        if (!run) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Successful run not found in project',
          })
        }
        const dedupeKey = `slate:${input.runId}`
        return db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ id: events.id })
            .from(events)
            .where(eq(events.dedupeKey, dedupeKey))
            .limit(1)
          if (existing) return { recorded: false }
          await appendEvent(tx, {
            id: randomUUID(),
            projectId: input.projectId,
            runId: input.runId,
            nodeId: null,
            type: 'SLATE_DISPLAYED',
            payload: {},
            dedupeKey,
          })
          return { recorded: true }
        })
      }),
    nodeOpened: t.procedure
      .input(
        z
          .object({
            projectId: z.string().uuid(),
            nodeId: z.string().uuid(),
          })
          .strict(),
      )
      .output(z.object({ eventId: z.string().uuid() }).strict())
      .mutation(async ({ ctx, input }) => {
        const { db } = ctx.getDatabase()
        const [node] = await db
          .select({ id: nodes.id })
          .from(nodes)
          .where(
            and(
              eq(nodes.id, input.nodeId),
              eq(nodes.projectId, input.projectId),
            ),
          )
          .limit(1)
        if (!node) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Node not found in project',
          })
        }
        const eventId = randomUUID()
        await appendEvent(db, {
          id: eventId,
          projectId: input.projectId,
          runId: null,
          nodeId: input.nodeId,
          type: 'NODE_OPENED',
          payload: {},
          dedupeKey: null,
        })
        return { eventId }
      }),
    list: t.procedure
      .input(EventInputSchema)
      .output(z.array(GenerationEventSchema))
      .query(async ({ ctx, input }) => {
        const rows = await listEvents(ctx.getDatabase().db, input.projectId)
        return rows.map(
          ({
            id,
            projectId,
            runId,
            nodeId,
            type,
            payload,
            dedupeKey,
            createdAt,
          }) => ({
            id,
            projectId,
            runId,
            nodeId,
            type,
            payload,
            dedupeKey,
            createdAt: createdAt.toISOString(),
          }),
        )
      }),
  }),
})

function throwServiceError(error: unknown): never {
  if (error instanceof GenerationServiceError) {
    throw new TRPCError({
      code: error.code,
      message: error.message,
    })
  }
  throw error
}

export type AppRouter = typeof appRouter
