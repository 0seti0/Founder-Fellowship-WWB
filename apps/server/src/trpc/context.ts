import { env } from '../env'
import { getDatabase } from '../db/client'

export function createContext(url = env.DATABASE_URL) {
  return {
    getDatabase: () => getDatabase(url),
  }
}

export type Context = ReturnType<typeof createContext>
