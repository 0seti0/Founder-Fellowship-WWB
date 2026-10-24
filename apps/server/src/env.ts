import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
})

const EnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (value) =>
          value.startsWith('mysql://') || value.startsWith('mysql2://'),
      )
      .default('mysql://unfold:unfold@localhost:3306/unfold'),
    MODEL_MODE: z.enum(['mock', 'live']).default('mock'),
    MODEL_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
  })
  .superRefine((value, ctx) => {
    if (value.MODEL_MODE === 'live' && !value.MODEL_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MODEL_API_KEY'],
        message: 'MODEL_API_KEY is required when MODEL_MODE=live',
      })
    }
  })

export function parseEnv(input: NodeJS.ProcessEnv) {
  return EnvironmentSchema.parse(input)
}

export const env = parseEnv(process.env)
