import { initTRPC } from '@trpc/server'
import { DbHealthSchema, HealthStatusSchema } from '@unfold/shared'
import type { RowDataPacket } from 'mysql2'
import { env } from '../env'
import { createContext } from './context'

const t = initTRPC.context<ReturnType<typeof createContext>>().create()

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
        (RowDataPacket & { count: number | string })[]
      >('SELECT COUNT(*) AS count FROM `__drizzle_migrations`')
      return {
        status: 'ok' as const,
        migrationsApplied: Number(rows[0]?.count ?? 0),
      }
    }),
  }),
})

export type AppRouter = typeof appRouter
