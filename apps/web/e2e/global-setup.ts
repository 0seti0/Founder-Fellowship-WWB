import { runMigrations } from '../../server/src/db/migrate'

export default async function globalSetup() {
  await runMigrations(
    process.env.DATABASE_URL_TEST ??
      'mysql://unfold:unfold@localhost:3306/unfold_test',
  )
}
