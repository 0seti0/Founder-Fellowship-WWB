import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'

vi.mock('../lib/trpc', () => ({
  trpcClient: {
    health: {
      ping: {
        query: vi.fn().mockResolvedValue({
          status: 'ok',
          service: 'unfold-server',
          modelMode: 'mock',
          time: '2025-01-01T00:00:00.000Z',
        }),
      },
    },
    projects: {
      list: { query: vi.fn().mockResolvedValue([]) },
    },
  },
}))

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Bottom: 'bottom', Top: 'top' },
  ReactFlow: () => null,
}))

describe('App shell', () => {
  it('renders the header and server status from a mocked tRPC response', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
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
    expect(screen.getByTestId('mock-model-badge')).toBeInTheDocument()
  })
})
