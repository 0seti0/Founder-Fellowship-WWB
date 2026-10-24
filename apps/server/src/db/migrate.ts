import { migrate } from 'drizzle-orm/mysql2/migrator'
import { drizzle } from 'drizzle-orm/mysql2'
import { createPool } from 'mysql2/promise'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { env } from '../env'

export async function runMigrations(
  url: string,
  migrationsFolder = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../drizzle',
  ),
) {
  const pool = createPool(url)
  try {
    await migrate(drizzle(pool), { migrationsFolder })
  } finally {
    await pool.end()
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  runMigrations(env.DATABASE_URL).catch((error: unknown) => {
    console.error('Database migrations failed')
    console.error(error)
    process.exitCode = 1
  })
}
