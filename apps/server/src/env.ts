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
    MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    LLM_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    MODEL_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    LLM_MODEL_STRONG: z.string().min(1).default('gpt-4.1'),
    LLM_MODEL_FAST: z.string().min(1).default('gpt-4.1-mini'),
    LLM_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.MODEL_MODE === 'live' &&
      !value.LLM_API_KEY &&
      !value.MODEL_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'LLM_API_KEY is required when MODEL_MODE=live',
      })
    }
  })

let warnedDeprecatedApiKey = false

export function parseEnv(input: NodeJS.ProcessEnv) {
  const parsed = EnvironmentSchema.parse(input)
  if (parsed.MODEL_API_KEY && !parsed.LLM_API_KEY && !warnedDeprecatedApiKey) {
    console.warn('MODEL_API_KEY is deprecated; use LLM_API_KEY instead.')
    warnedDeprecatedApiKey = true
  }
  return parsed
}

export const env = parseEnv(process.env)
