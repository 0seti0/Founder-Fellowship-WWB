import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { appRouter } from '../src/trpc/router'
import { createContext } from '../src/trpc/context'

describe('server health', () => {
  it('serves the health status over HTTP', async () => {
    const response = await createApp().request('/health')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ok',
      service: 'unfold-server',
      modelMode: 'mock',
    })
    expect(body).not.toHaveProperty('MODEL_API_KEY')
    expect(body.time).toBeTypeOf('string')
  })

  it('answers health.ping without opening a database connection', async () => {
    const response = await appRouter.createCaller(createContext()).health.ping()

    expect(response).toMatchObject({ status: 'ok', modelMode: 'mock' })
  })
})
