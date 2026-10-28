import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { forkOptions, pathTo, pickOperator } from '../lib/forks'
import { trpcClient } from '../lib/trpc'

export function ForkPanel({
  projectId,
  mockScenario,
}: {
  projectId: string
  mockScenario: string | null
}) {
  const queryClient = useQueryClient()
  const project = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => trpcClient.projects.get.query({ id: projectId }),
    retry: false,
  })
  const data = project.data
  const root = data?.nodes.find((node) => node.type === 'ROOT_PROMPT') ?? null
  const [forkParentId, setForkParentId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [building, setBuilding] = useState<{
    title: string
    since: number
  } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const parentId = forkParentId ?? root?.id ?? null

  const options = useMemo(
    () => (data && parentId ? forkOptions(parentId, data) : []),
    [data, parentId],
  )
  const path = useMemo(
    () => (data && parentId ? pathTo(parentId, data) : []),
    [data, parentId],
  )
  const focused =
    options.find((option) => option.nodeId === focusedId) ??
    options.find((option) => option.suggested) ??
    options[0]

  useEffect(() => {
    if (!building) return
    const id = window.setInterval(
      () => setElapsed(Math.floor((performance.now() - building.since) / 1000)),
      500,
    )
    return () => window.clearInterval(id)
  }, [building])

  async function choose(nodeId: string, title: string) {
    if (!data || building) return
    setError(null)
    setBuilding({ title, since: performance.now() })
    setElapsed(0)
    try {
      await trpcClient.nodes.setActive.mutate({ projectId, nodeId })
      if (!forkOptions(nodeId, data).length) {
        const available = await trpcClient.nodes.operatorOptions.query({
          projectId,
          parentNodeId: nodeId,
        })
        const operator = pickOperator(available)
        if (!operator)
          throw new Error('No operator can build on this direction yet.')
        const result = await trpcClient.projects.expand.mutate({
          projectId,
          parentNodeId: nodeId,
          operator,
          ...(mockScenario ? { mockScenario: mockScenario as never } : {}),
        })
        if (result.status === 'FAILED')
          throw new Error(result.errorCode ?? 'Expansion failed.')
      }
      await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      await project.refetch()
      setForkParentId(nodeId)
      setFocusedId(null)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Something went wrong.',
      )
    } finally {
      setBuilding(null)
    }
  }

  return (
    <div className="p-abs p-fork" data-testid="fork-panel">
      <nav className="p-path" aria-label="Your path">
        {path.map((node, index) => (
          <button
            key={node.id}
            type="button"
            className={index === path.length - 1 ? 'is-current' : ''}
            disabled={Boolean(building) || index === path.length - 1}
            onClick={() => {
              const previous = path[index - 1]
              setForkParentId(previous ? previous.id : (root?.id ?? null))
              setFocusedId(node.id)
            }}
          >
            {node.type === 'ROOT_PROMPT' ? 'Your prompt' : node.title}
          </button>
        ))}
      </nav>
      <div className="p-eyebrow p-fork-status" aria-live="polite">
        {building
          ? `Claude is building on “${building.title}” · ${elapsed}s`
          : error
            ? `Couldn’t build on that · ${error}`
            : 'Which of these is closest to what you mean?'}
      </div>
      <div
        className="p-fork-options"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))`,
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.nodeId}
            type="button"
            className={`p-option ${focused?.nodeId === option.nodeId ? 'is-focused' : ''}`}
            disabled={Boolean(building)}
            onMouseEnter={() => setFocusedId(option.nodeId)}
            onFocus={() => setFocusedId(option.nodeId)}
            onClick={() => void choose(option.nodeId, option.title)}
          >
            <span className="p-option-hd">
              <span>Option {String(index + 1).padStart(2, '0')}</span>
              {option.suggested && (
                <span className="p-suggested">Suggested</span>
              )}
            </span>
            <span className="p-option-title">{option.title}</span>
            {option.assumption && (
              <span className="p-option-assume">
                Assumes · {option.assumption}
              </span>
            )}
            <span className="p-option-cta">Choose and build on this →</span>
          </button>
        ))}
        {!options.length && !building && (
          <p className="p-fork-empty">
            No open directions here. Go back along your path to choose another.
          </p>
        )}
      </div>
      {focused && (
        <div className="p-fork-defend">
          <div className="p-col p-adv is-shown">
            <h4>The case for it</h4>
            <p>{focused.fitRationale}</p>
          </div>
          <div className="p-col p-crit is-shown">
            <h4>Strongest objection</h4>
            <p>{focused.strongestObjection}</p>
          </div>
          <div className="p-col p-test is-shown">
            <h4>First test</h4>
            <p>{focused.firstTest}</p>
          </div>
        </div>
      )}
    </div>
  )
}
