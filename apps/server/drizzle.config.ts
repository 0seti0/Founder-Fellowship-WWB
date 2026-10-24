import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'mysql://unfold:unfold@localhost:3306/unfold',
  },
})
