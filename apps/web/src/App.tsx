import { useQuery } from '@tanstack/react-query'
import { Background, Controls, ReactFlow } from '@xyflow/react'
import { useMemo } from 'react'
import '@xyflow/react/dist/style.css'
import { layoutWithDagre } from './lib/layout'
import { trpcClient } from './lib/trpc'

const placeholderNodes = [
  {
    id: 'origin',
    data: { label: 'A starting point' },
    position: { x: 0, y: 0 },
  },
  {
    id: 'question',
    data: { label: 'A question to explore' },
    position: { x: 0, y: 0 },
  },
  {
    id: 'direction',
    data: { label: 'A possible direction' },
    position: { x: 0, y: 0 },
  },
]

const placeholderEdges = [
  { id: 'origin-question', source: 'origin', target: 'question' },
  { id: 'question-direction', source: 'question', target: 'direction' },
]

export function App() {
  const health = useQuery({
    queryKey: ['health', 'ping'],
    queryFn: () => trpcClient.health.ping.query(),
    retry: false,
  })
  const nodes = useMemo(
    () => layoutWithDagre(placeholderNodes, placeholderEdges),
    [],
  )
  const statusLabel = health.isPending
    ? 'checking'
    : health.isError
      ? 'unavailable'
      : `${health.data.status} · ${health.data.modelMode}`

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#80796e]">
            A space to think
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[#24231f]">
            Unfold
          </h1>
        </div>
        <div
          data-testid="server-status"
          data-state={
            health.isError ? 'error' : health.isSuccess ? 'ok' : 'loading'
          }
          className={`rounded-full border px-4 py-2 text-sm font-medium ${
            health.isError
              ? 'border-red-200 bg-red-50 text-red-700'
              : health.isSuccess
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-[#dedbd3] bg-white text-[#716d64]'
          }`}
        >
          Server · {statusLabel}
        </div>
      </header>

      <section className="mx-auto mt-12 max-w-6xl">
        <div className="mb-5">
          <p className="text-sm font-semibold text-[#423f38]">
            A place for ideas to take shape
          </p>
          <p className="mt-1 text-sm text-[#80796e]">
            This sample canvas is a placeholder. Nothing here is editable or
            saved.
          </p>
        </div>
        <div
          data-testid="graph-canvas"
          aria-label="Placeholder idea graph"
          className="h-[520px] overflow-hidden rounded-2xl border border-[#e2ded5] bg-[#fffefa] shadow-sm"
        >
          <ReactFlow
            nodes={nodes}
            edges={placeholderEdges}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#e7e4dc" gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>
    </main>
  )
}
