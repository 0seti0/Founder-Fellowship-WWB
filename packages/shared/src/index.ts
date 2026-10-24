import { z } from 'zod'

export const ModelModeSchema = z.enum(['mock', 'live'])

export const HealthStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('unfold-server'),
  modelMode: ModelModeSchema,
  time: z.iso.datetime(),
})

export const DbHealthSchema = z.object({
  status: z.literal('ok'),
  migrationsApplied: z.number().int().min(0),
})

export type ModelMode = z.infer<typeof ModelModeSchema>
export type HealthStatus = z.infer<typeof HealthStatusSchema>
export type DbHealth = z.infer<typeof DbHealthSchema>
