import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { trpcClient } from '../lib/trpc'

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
      get: { query: vi.fn().mockResolvedValue(null) },
    },
    nodes: {
      operatorOptions: { query: vi.fn().mockResolvedValue([]) },
    },
    events: {
      nodeOpened: { mutate: vi.fn().mockResolvedValue(null) },
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

  it('renders historical facets in the inspector', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111'
    const rootId = '22222222-2222-4222-8222-222222222222'
    const ideaId = '33333333-3333-4333-8333-333333333333'
    const runId = '44444444-4444-4444-8444-444444444444'
    const createdAt = '2025-01-01T00:00:00.000Z'
    const previousUrl = window.location.href
    window.history.replaceState(
      null,
      '',
      `/?project=${projectId}&node=${ideaId}`,
    )
    vi.mocked(trpcClient.projects.get.query).mockResolvedValue({
      project: {
        id: projectId,
        title: 'Neighborhood bakery',
        originalPrompt: 'I want to open a neighborhood bakery.',
        activeNodeId: ideaId,
        createdAt,
        updatedAt: createdAt,
      },
      nodes: [
        {
          id: rootId,
          projectId,
          type: 'ROOT_PROMPT',
          origin: 'PROMPT',
          operator: null,
          runId: null,
          candidateId: null,
          title: 'I want to open a neighborhood bakery.',
          summary: 'I want to open a neighborhood bakery.',
          content: {},
          displayPosition: 0,
          status: 'VISIBLE',
          userEdited: false,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: ideaId,
          projectId,
          type: 'IDEA',
          origin: 'INITIAL_FRAME',
          operator: null,
          runId,
          candidateId: null,
          title: 'A weekly bread preorder',
          summary: 'Offer a weekly preorder to nearby families.',
          content: {
            key: 'k1',
            title: 'A weekly bread preorder',
            summary: 'Offer a weekly preorder to nearby families.',
            hypothesis: {
              statement: 'Nearby families may value weekly bread.',
              assumptions: ['Families want a regular pickup.'],
              supportingFactRefs: [],
              counterevidence: [],
              falsifiers: ['Nobody signs up.'],
            },
            preservedIntent: 'Explore a neighborhood bakery.',
            changedAssumptions: ['Start with a weekly preorder.'],
            fitRationale: 'Preorders test demand before opening.',
            strongestObjection: 'Families may prefer daily choices.',
            firstTest: 'Ask six families to preorder by Friday.',
            mechanism: 'Weekly preorder and pickup.',
            facets: ['Neighborhood demand', 'Preorder operations'],
            distance: 'near',
          },
          displayPosition: 1,
          status: 'VISIBLE',
          userEdited: false,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      edges: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          projectId,
          parentId: rootId,
          childId: ideaId,
          runId,
          createdAt,
        },
      ],
      latestRun: null,
      latestExpansionRun: null,
      analysis: { facts: [], constraints: [] },
      candidates: [],
    } as never)
    vi.mocked(trpcClient.nodes.operatorOptions.query).mockResolvedValue(
      [] as never,
    )
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

    expect(
      await screen.findByRole('heading', { name: 'Facets' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Neighborhood demand')).toBeInTheDocument()
    expect(screen.getByText('Preorder operations')).toBeInTheDocument()
    window.history.replaceState(null, '', previousUrl)
  })
})
