import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  MockScenarioSchema,
  type CandidateDto,
  type GraphNodeDto,
  type MockScenario,
} from '@unfold/shared'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import '@xyflow/react/dist/style.css'
import { layoutWithDagre } from './lib/layout'
import { trpcClient } from './lib/trpc'

type GraphNodeData = {
  title: string
  subtitle: string
  root: boolean
  testId: string
}

const nodeTypes = { graphCard: GraphCard }

export function App() {
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState(() =>
    new URLSearchParams(window.location.search).get('project'),
  )
  const [selectedNodeId, setSelectedNodeId] = useState(() =>
    new URLSearchParams(window.location.search).get('node'),
  )
  const [initialNodePending, setInitialNodePending] = useState(() =>
    Boolean(new URLSearchParams(window.location.search).get('node')),
  )
  const [prompt, setPrompt] = useState('')
  const [mockScenario, setMockScenario] = useState<MockScenario>('default')
  const [isCreating, setIsCreating] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 640px)').matches,
  )
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const graphContainerRef = useRef<HTMLDivElement>(null)
  const [graphContainerSize, setGraphContainerSize] = useState('')
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const reportedSlateRuns = useRef(new Set<string>())

  const health = useQuery({
    queryKey: ['health', 'ping'],
    queryFn: () => trpcClient.health.ping.query(),
    retry: false,
  })
  const projectsQuery = useQuery({
    queryKey: ['projects', 'list'],
    queryFn: () => trpcClient.projects.list.query(),
    retry: false,
  })
  const projectQuery = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => trpcClient.projects.get.query({ id: projectId! }),
    enabled: Boolean(projectId),
    retry: false,
  })
  const projectData = projectQuery.data
  const selectedNode = projectData?.nodes.find(
    (node) => node.id === selectedNodeId,
  )
  const selectedCandidate = selectedNode?.candidateId
    ? (projectData?.candidates.find(
        (candidate) => candidate.id === selectedNode.candidateId,
      ) ?? null)
    : null

  const graphNodes = useMemo(() => {
    if (!projectData) return []
    const rawNodes: Node<GraphNodeData>[] = projectData.nodes.map((node) => {
      const candidate = node.candidateId
        ? projectData.candidates.find((item) => item.id === node.candidateId)
        : undefined
      return {
        id: node.id,
        type: 'graphCard',
        data: {
          title: node.type === 'ROOT_PROMPT' ? 'Your prompt' : node.title,
          subtitle:
            node.type === 'ROOT_PROMPT'
              ? node.summary
              : `Direction · ${candidate?.content.distance ?? 'near'}`,
          root: node.type === 'ROOT_PROMPT',
          testId: `graph-node-${node.type === 'ROOT_PROMPT' ? 'root' : 'idea'}`,
        },
        position: { x: 0, y: 0 },
        width: 252,
        height: node.type === 'ROOT_PROMPT' ? 124 : 112,
        selected: node.id === selectedNodeId,
      }
    })
    const graphEdges: Edge[] = projectData.edges.map((edge) => ({
      id: edge.id,
      source: edge.parentId,
      target: edge.childId,
    }))
    return layoutWithDagre(rawNodes, graphEdges)
  }, [projectData, selectedNodeId])

  const graphEdges = useMemo<Edge[]>(
    () =>
      (projectData?.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.parentId,
        target: edge.childId,
      })),
    [projectData],
  )

  const graphFitKey = useMemo(
    () =>
      JSON.stringify({
        size: graphContainerSize,
        nodes: graphNodes.map(
          ({ id, position, width, height, selected, data }) => ({
            id,
            position,
            width,
            height,
            selected,
            title: data.title,
            subtitle: data.subtitle,
          }),
        ),
      }),
    [graphContainerSize, graphNodes],
  )

  useEffect(() => {
    const graphContainer = graphContainerRef.current
    if (!graphContainer || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      const size = `${Math.round(width)}x${Math.round(height)}`
      setGraphContainerSize((current) => (current === size ? current : size))
    })
    observer.observe(graphContainer)
    return () => observer.disconnect()
  }, [projectData])

  const closeInspector = useCallback(() => {
    if (projectData) updateUrl(projectData.project.id, null)
    setSelectedNodeId(null)
    previousFocusRef.current?.focus()
  }, [projectData])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    const update = () => setIsMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!projectData || !selectedNodeId || !initialNodePending) return
    if (projectData.nodes.some((node) => node.id === selectedNodeId)) {
      void trpcClient.events.nodeOpened
        .mutate({ projectId: projectData.project.id, nodeId: selectedNodeId })
        .catch(() => undefined)
    } else {
      setSelectedNodeId(null)
      updateUrl(projectData.project.id, null)
    }
    setInitialNodePending(false)
  }, [initialNodePending, projectData, selectedNodeId])

  useEffect(() => {
    const run = projectData?.latestRun
    if (
      !projectData ||
      run?.status !== 'SUCCEEDED' ||
      !projectData.nodes.some((node) => node.type === 'IDEA') ||
      reportedSlateRuns.current.has(run.id)
    )
      return
    reportedSlateRuns.current.add(run.id)
    void trpcClient.events.slateDisplayed
      .mutate({ projectId: projectData.project.id, runId: run.id })
      .catch(() => undefined)
  }, [projectData])

  useEffect(() => {
    if (!isMobile || !selectedNode) return
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeInspector()
      if (event.key === 'Tab') {
        event.preventDefault()
        closeButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeInspector, isMobile, selectedNode])

  async function unfold() {
    setUiError(null)
    setIsCreating(true)
    setSelectedNodeId(null)
    try {
      const result = await trpcClient.projects.create.mutate({
        prompt,
        ...(health.data?.modelMode === 'mock' ? { mockScenario } : {}),
      })
      setProjectId(result.projectId)
      updateUrl(result.projectId, null)
      await queryClient.invalidateQueries({ queryKey: ['projects', 'list'] })
    } catch (error) {
      setUiError(errorMessage(error))
    } finally {
      setIsCreating(false)
    }
  }

  async function retryGeneration() {
    if (!projectData) return
    setUiError(null)
    setIsRetrying(true)
    try {
      await trpcClient.projects.generateInitial.mutate({
        projectId: projectData.project.id,
        ...(health.data?.modelMode === 'mock' ? { mockScenario } : {}),
      })
      await queryClient.invalidateQueries({
        queryKey: ['projects', projectData.project.id],
      })
    } catch (error) {
      setUiError(errorMessage(error))
    } finally {
      setIsRetrying(false)
    }
  }

  function openNode(nodeId: string) {
    if (!projectData) return
    const node = projectData.nodes.find((item) => item.id === nodeId)
    if (!node) return
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setInitialNodePending(false)
    setSelectedNodeId(nodeId)
    updateUrl(projectData.project.id, nodeId)
    void trpcClient.events.nodeOpened
      .mutate({ projectId: projectData.project.id, nodeId })
      .catch(() => undefined)
  }

  function openProject(id: string) {
    setProjectId(id)
    setSelectedNodeId(null)
    setInitialNodePending(false)
    setUiError(null)
    updateUrl(id, null)
  }

  const modelMode = health.data?.modelMode
  const run = projectData?.latestRun
  const isFailed = run?.status === 'FAILED'
  const isGenerating =
    isCreating || isRetrying || (Boolean(projectId) && projectQuery.isPending)
  const serverLabel = health.isPending
    ? 'checking'
    : health.isError
      ? 'unavailable'
      : `${health.data.status} · ${health.data.modelMode}`

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">A space to think</p>
          <h1>Unfold</h1>
        </div>
        <div className="topbar-status">
          {modelMode === 'mock' && (
            <span className="model-badge" data-testid="mock-model-badge">
              Mock model
            </span>
          )}
          <div
            data-testid="server-status"
            data-state={
              health.isError ? 'error' : health.isSuccess ? 'ok' : 'loading'
            }
            className={`server-status ${health.isError ? 'is-error' : ''}`}
          >
            Server · {serverLabel}
          </div>
        </div>
      </header>

      <div className="page-grid">
        <aside className="sidebar" aria-label="Prompt and projects">
          <section className="composer">
            <p className="eyebrow">Start with a possibility</p>
            <h2>What are you exploring?</h2>
            <label htmlFor="prompt-input">Your prompt</label>
            <textarea
              id="prompt-input"
              value={prompt}
              maxLength={4000}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="I want to explore an idea for…"
              rows={5}
            />
            {modelMode === 'mock' && (
              <div className="scenario-field">
                <label htmlFor="mock-scenario">Mock scenario</label>
                <select
                  id="mock-scenario"
                  value={mockScenario}
                  onChange={(event) =>
                    setMockScenario(event.target.value as MockScenario)
                  }
                >
                  {MockScenarioSchema.options.map((scenario) => (
                    <option key={scenario} value={scenario}>
                      {scenario}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={!prompt.trim() || isCreating}
              onClick={() => void unfold()}
            >
              {isCreating ? 'Unfolding…' : 'Unfold'}
            </button>
            {uiError && (
              <p className="inline-error" role="alert">
                {uiError}
              </p>
            )}
          </section>

          <section
            className="project-list"
            aria-labelledby="project-list-title"
          >
            <div className="section-heading">
              <h2 id="project-list-title">Your projects</h2>
              <span>{projectsQuery.data?.length ?? 0}</span>
            </div>
            {projectsQuery.data?.length ? (
              <ul>
                {projectsQuery.data.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      className={
                        project.id === projectId
                          ? 'project-link active'
                          : 'project-link'
                      }
                      title={project.title}
                      onClick={() => openProject(project.id)}
                    >
                      {project.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">Your explorations will appear here.</p>
            )}
          </section>
        </aside>

        <section className="exploration" aria-label="Idea graph workspace">
          {isGenerating && (
            <div className="workspace-message" role="status">
              <span className="loading-mark" aria-hidden="true" />
              <div>
                <h2>Finding possible directions</h2>
                <p>Building a few distinct hypotheses from your prompt…</p>
              </div>
            </div>
          )}
          {projectQuery.isError && !isGenerating && (
            <div className="workspace-message error-message" role="alert">
              <h2>Could not load this project</h2>
              <p>{errorMessage(projectQuery.error)}</p>
            </div>
          )}
          {!projectId && !isGenerating && (
            <div className="workspace-message empty-message">
              <div className="empty-symbol" aria-hidden="true">
                ✳
              </div>
              <h2>A place for ideas to take shape</h2>
              <p>
                Enter an underspecified prompt to see several different ways
                forward.
              </p>
            </div>
          )}
          {projectData && !isGenerating && (
            <>
              <div className="workspace-heading">
                <div>
                  <p className="eyebrow">Exploration</p>
                  <h2 title={projectData.project.title}>
                    {projectData.project.title}
                  </h2>
                </div>
                {run?.status === 'SUCCEEDED' && (
                  <p className="direction-count">
                    {
                      projectData.nodes.filter((node) => node.type === 'IDEA')
                        .length
                    }{' '}
                    directions
                  </p>
                )}
              </div>
              {isFailed && (
                <div
                  className="failure-state"
                  data-testid="failure-state"
                  role="alert"
                >
                  <div>
                    <h3>We couldn’t unfold this prompt</h3>
                    <p>
                      {run.errorMessage ??
                        'Generation failed. Your prompt is saved.'}
                    </p>
                    <p className="failure-code">Run status · {run.errorCode}</p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isRetrying}
                    onClick={() => void retryGeneration()}
                  >
                    {isRetrying ? 'Trying again…' : 'Try again'}
                  </button>
                </div>
              )}
              <div
                ref={graphContainerRef}
                className={`workspace-graph ${selectedNode ? 'with-inspector' : ''}`}
                data-testid="graph-canvas"
                aria-label="Idea graph"
              >
                <ReactFlow
                  key={graphFitKey}
                  nodes={graphNodes}
                  edges={graphEdges}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  onNodeClick={(_, node) => openNode(node.id)}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  minZoom={0.2}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="#e5e1d7" gap={24} size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
              {selectedNode && (
                <Inspector
                  node={selectedNode}
                  candidate={selectedCandidate}
                  isMobile={isMobile}
                  closeButtonRef={closeButtonRef}
                  onClose={closeInspector}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function GraphCard({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className="graph-card" data-testid={data.testId}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <button type="button" aria-label={`Open ${data.title}`}>
        <span className="graph-card-title">{data.title}</span>
        <span className={data.root ? 'graph-card-root' : 'graph-card-subtitle'}>
          {data.subtitle}
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}

function Inspector({
  node,
  candidate,
  isMobile,
  closeButtonRef,
  onClose,
}: {
  node: GraphNodeDto
  candidate: CandidateDto | null
  isMobile: boolean
  closeButtonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  return (
    <aside
      className={`inspector ${isMobile ? 'inspector-mobile' : 'inspector-desktop'}`}
      role={isMobile ? 'dialog' : 'complementary'}
      aria-modal={isMobile ? true : undefined}
      aria-labelledby="inspector-title"
      data-testid={isMobile ? 'inspector-dialog' : 'inspector-panel'}
    >
      <div className="inspector-header">
        <div>
          <p className="eyebrow">
            {node.type === 'ROOT_PROMPT' ? 'Origin' : 'Direction'}
          </p>
          <h2 id="inspector-title">{node.title}</h2>
        </div>
        <button
          ref={closeButtonRef}
          className="close-button"
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {candidate ? (
        <div className="inspector-content">
          <InspectorSection title="Summary">
            {candidate.content.summary}
          </InspectorSection>
          <InspectorSection title="Preserved intent">
            {candidate.content.preservedIntent}
          </InspectorSection>
          <InspectorSection title="Changed assumptions">
            <ul>
              {candidate.content.changedAssumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </InspectorSection>
          <InspectorSection title="Why it might fit">
            {candidate.content.fitRationale}
          </InspectorSection>
          <InspectorSection title="Strongest objection">
            {candidate.content.strongestObjection}
          </InspectorSection>
          <InspectorSection title="First test">
            {candidate.content.firstTest}
          </InspectorSection>
          <InspectorSection title="Mechanism">
            {candidate.content.mechanism}
          </InspectorSection>
          <InspectorSection title="Facets">
            <div className="facet-list">
              {candidate.content.facets.map((facet) => (
                <span key={facet}>{facet}</span>
              ))}
            </div>
          </InspectorSection>
          <InspectorSection title="Hypothesis — not confirmed intent">
            <p>{candidate.hypothesis.statement}</p>
            <h4>Assumptions</h4>
            <ul>
              {candidate.hypothesis.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
            <h4>Falsifiers</h4>
            <ul>
              {candidate.hypothesis.falsifiers.map((falsifier) => (
                <li key={falsifier}>{falsifier}</li>
              ))}
            </ul>
          </InspectorSection>
          <InspectorSection title="Constraint uncertainty">
            {candidate.constraintEvaluations.some(
              (item) => item.status === 'unknown',
            ) ? (
              <ul>
                {candidate.constraintEvaluations
                  .filter((item) => item.status === 'unknown')
                  .map((item) => (
                    <li key={item.constraintRef}>
                      {item.text ?? item.constraintRef} — unknown
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No unresolved constraints.</p>
            )}
          </InspectorSection>
        </div>
      ) : (
        <div className="inspector-content">
          <InspectorSection title="Prompt">{node.summary}</InspectorSection>
        </div>
      )}
    </aside>
  )
}

function InspectorSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  )
}

function updateUrl(projectId: string | null, nodeId: string | null) {
  const url = new URL(window.location.href)
  if (projectId) url.searchParams.set('project', projectId)
  else url.searchParams.delete('project')
  if (nodeId) url.searchParams.set('node', nodeId)
  else url.searchParams.delete('node')
  window.history.replaceState(null, '', url)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
