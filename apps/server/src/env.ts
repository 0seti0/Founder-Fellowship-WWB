import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value)

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
    APP_TIMEZONE: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
    LLM_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    MODEL_API_KEY: z
      .string()
      .optional()
      .transform((value) => value || undefined),
    LLM_BASE_URL: z.preprocess(emptyAsUndefined, z.string().url().optional()),
    LLM_MODEL_STRONG: z.preprocess(
      emptyAsUndefined,
      z.string().min(1).optional(),
    ),
    LLM_MODEL_FAST: z.preprocess(
      emptyAsUndefined,
      z.string().min(1).optional(),
    ),
    LLM_EMBEDDING_MODEL: z.preprocess(
      emptyAsUndefined,
      z.string().min(1).optional(),
    ),
    LLM_TEMPERATURE: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().min(0).max(2).optional(),
    ),
    LLM_MAX_TOKENS: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().positive().optional(),
    ),
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
  .transform((value) => {
    const defaults =
      value.LLM_PROVIDER === 'anthropic'
        ? {
            baseUrl: 'https://api.anthropic.com/v1',
            strongModel: 'claude-sonnet-4-5',
            fastModel: 'claude-haiku-4-5',
          }
        : {
            baseUrl: 'https://api.openai.com/v1',
            strongModel: 'gpt-4.1',
            fastModel: 'gpt-4.1-mini',
          }
    return {
      ...value,
      LLM_BASE_URL: value.LLM_BASE_URL ?? defaults.baseUrl,
      LLM_MODEL_STRONG: value.LLM_MODEL_STRONG ?? defaults.strongModel,
      LLM_MODEL_FAST: value.LLM_MODEL_FAST ?? defaults.fastModel,
      LLM_EMBEDDING_MODEL:
        value.LLM_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      LLM_MAX_TOKENS: value.LLM_MAX_TOKENS ?? 16_000,
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
