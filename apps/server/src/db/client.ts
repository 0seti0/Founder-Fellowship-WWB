import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import * as schema from './schema'

export type DatabaseConnection = {
  db: MySql2Database<typeof schema>
  pool: Pool
}

const connections = new Map<string, DatabaseConnection>()

export function getDatabase(url: string): DatabaseConnection {
  const existing = connections.get(url)
  if (existing) return existing

  const pool = createPool(url)
  const connection = { db: drizzle(pool, { mode: 'default', schema }), pool }
  connections.set(url, connection)
  return connection
}

export async function closeDatabase(url: string) {
  const connection = connections.get(url)
  if (connection) {
    connections.delete(url)
    await connection.pool.end()
  }
}
