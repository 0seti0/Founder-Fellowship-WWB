import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  ReactFlow: () => null,
}))

describe('App shell', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders the header and server status from a mocked tRPC response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              result: {
                data: {
                  status: 'ok',
                  service: 'unfold-server',
                  modelMode: 'mock',
                  time: '2025-01-01T00:00:00.000Z',
                },
              },
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Unfold' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('server-status')).toHaveTextContent(
        'ok · mock',
      ),
    )
  })
})
