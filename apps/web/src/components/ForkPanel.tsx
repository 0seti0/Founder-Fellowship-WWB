import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { formatErrorMessage } from '../lib/errorMessage'
import { forkOptions, pathTo, pickOperator } from '../lib/forks'
import { buildGrowGraph } from '../lib/growGraph'
import { trpcClient } from '../lib/trpc'
import { GrowGraph } from './GrowGraph'

const GRAPH_WIDTH = 1460
const GRAPH_HEIGHT = { choosing: 330, building: 600 }
const SETTLE_MS = 1400

type Build = {
  parentId: string
  title: string
  runId: string | null
  since: number
}

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
  const [build, setBuild] = useState<Build | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const parentId = build?.parentId ?? forkParentId ?? root?.id ?? null

  const runProgress = useQuery({
    queryKey: ['runs', 'progress', build?.runId],
    queryFn: () =>
      trpcClient.runs.progress.query({ projectId, runId: build!.runId! }),
    enabled: Boolean(build?.runId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'RUNNING' ? false : 700,
  })
  const liveRun =
    build?.runId && runProgress.data?.runId === build.runId
      ? runProgress.data
      : null

  const options = useMemo(
    () => (data && parentId && !build ? forkOptions(parentId, data) : []),
    [data, parentId, build],
  )
  const path = useMemo(
    () => (data && parentId ? pathTo(parentId, data) : []),
    [data, parentId],
  )
  const focused =
    options.find((option) => option.nodeId === focusedId) ??
    options.find((option) => option.suggested) ??
    options[0]
  const graph = useMemo(
    () =>
      data && parentId
        ? buildGrowGraph(data, {
            parentId,
            focusedId: focused?.nodeId ?? null,
            suggestedId:
              options.find((option) => option.suggested)?.nodeId ?? null,
            build: build
              ? {
                  parentId: build.parentId,
                  runId: build.runId,
                  progress: liveRun?.progress ?? null,
                }
              : null,
          })
        : null,
    [data, parentId, focused, options, build, liveRun],
  )

  useEffect(() => {
    if (!build) return
    const id = window.setInterval(
      () => setElapsed(Math.floor((performance.now() - build.since) / 1000)),
      500,
    )
    return () => window.clearInterval(id)
  }, [build])

  useEffect(() => {
    if (!build || !liveRun) return
    if (liveRun.status === 'FAILED') {
      setError(liveRun.errorMessage ?? liveRun.errorCode ?? 'Expansion failed')
      setBuild(null)
      return
    }
    if (liveRun.status !== 'SUCCEEDED') return
    let cancelled = false
    const id = window.setTimeout(async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      await project.refetch()
      if (cancelled) return
      setForkParentId(build.parentId)
      setFocusedId(null)
      setBuild(null)
    }, SETTLE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
    // `project` is a stable query handle; re-running on its identity would restart the settle delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, liveRun, projectId, queryClient])

  async function choose(nodeId: string, title: string) {
    if (!data || build) return
    setError(null)
    setFocusedId(null)
    setElapsed(0)
    try {
      await trpcClient.nodes.setActive.mutate({ projectId, nodeId })
      if (forkOptions(nodeId, data).length) {
        await queryClient.invalidateQueries({
          queryKey: ['projects', projectId],
        })
        await project.refetch()
        setForkParentId(nodeId)
        return
      }
      setBuild({
        parentId: nodeId,
        title,
        runId: null,
        since: performance.now(),
      })
      const available = await trpcClient.nodes.operatorOptions.query({
        projectId,
        parentNodeId: nodeId,
      })
      const operator = pickOperator(available)
      if (!operator)
        throw new Error('No operator can build on this direction yet.')
      const started = await trpcClient.projects.expandStart.mutate({
        projectId,
        parentNodeId: nodeId,
        operator,
        ...(mockScenario ? { mockScenario: mockScenario as never } : {}),
      })
      setBuild((current) =>
        current && current.parentId === nodeId
          ? { ...current, runId: started.runId }
          : current,
      )
    } catch (caught) {
      setError(formatErrorMessage(caught))
      setBuild(null)
    }
  }

  const progress = liveRun?.progress ?? null
  const drafts = progress?.drafts?.length ?? 0
  const candidates = progress?.candidates.length ?? 0
  const kept =
    progress?.candidates.filter(
      (candidate) => candidate.selectionState === 'SELECTED',
    ).length ?? 0
  const status = build
    ? progress?.stage === 'SELECTED' || liveRun?.status === 'SUCCEEDED'
      ? `Kept ${kept} of ${candidates} · the next fork is ready`
      : progress?.stage === 'FRAMED' || progress?.stage === 'EVALUATED'
        ? `Claude is scoring ${candidates} new directions · ${elapsed}s`
        : drafts
          ? `Claude is branching from “${build.title}” · ${drafts} written · ${elapsed}s`
          : `Claude is building on “${build.title}” · ${elapsed}s`
    : error
      ? `Couldn’t build on that · ${error}`
      : 'Which of these is closest to what you mean?'

  return (
    <div
      className={`p-abs p-fork ${build ? 'is-building' : ''}`}
      data-testid="fork-panel"
    >
      <nav className="p-path" aria-label="Your path">
        {path.map((node, index) => (
          <button
            key={node.id}
            type="button"
            className={index === path.length - 1 ? 'is-current' : ''}
            disabled={Boolean(build) || index === path.length - 1}
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
      {graph && (
        <GrowGraph
          layout={graph}
          width={GRAPH_WIDTH}
          height={build ? GRAPH_HEIGHT.building : GRAPH_HEIGHT.choosing}
        />
      )}
      <div className="p-eyebrow p-fork-status" aria-live="polite">
        {status}
      </div>
      {!build && (
        <>
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
            {!options.length && (
              <p className="p-fork-empty">
                No open directions here. Go back along your path to choose
                another.
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
        </>
      )}
    </div>
  )
}
