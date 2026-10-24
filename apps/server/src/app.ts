import { trpcServer } from '@hono/trpc-server'
import { HealthStatusSchema } from '@unfold/shared'
import { Hono } from 'hono'
import { env } from './env'
import { createContext } from './trpc/context'
import { appRouter } from './trpc/router'

export function createApp() {
  const app = new Hono()

  app.get('/health', (c) =>
    c.json(
      HealthStatusSchema.parse({
        status: 'ok',
        service: 'unfold-server',
        modelMode: env.MODEL_MODE,
        time: new Date().toISOString(),
      }),
    ),
  )
  app.use(
    '/trpc/*',
    trpcServer({ router: appRouter, createContext: () => createContext() }),
  )

  return app
}
