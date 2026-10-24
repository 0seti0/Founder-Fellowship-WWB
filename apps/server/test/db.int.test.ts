import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../src/db/client'
import { appMeta } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import { appRouter } from '../src/trpc/router'
import { createContext } from '../src/trpc/context'

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
})
