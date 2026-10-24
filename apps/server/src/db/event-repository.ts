import { asc, eq } from 'drizzle-orm'
import type { DatabaseConnection } from './client'
import { events } from './schema'

type EventWriter = Pick<DatabaseConnection['db'], 'insert'>

export async function appendEvent(
  writer: EventWriter,
  event: typeof events.$inferInsert,
) {
  await writer.insert(events).values(event)
}

export async function listEvents(
  db: DatabaseConnection['db'],
  projectId: string,
) {
  return db
    .select()
    .from(events)
    .where(eq(events.projectId, projectId))
    .orderBy(asc(events.seq))
}
