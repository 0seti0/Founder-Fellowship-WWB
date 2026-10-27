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
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  IdeaContentSchema,
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
import { layoutWithPreservedPositions } from './lib/layout'
import { buildRenderedGraph } from './lib/renderedGraph'
import { trpcClient } from './lib/trpc'
import { LensView } from './components/LensView'
import { Stage2Controls } from './components/Stage2Controls'

type GraphNodeData = {
  title: string
  subtitle: string
  root: boolean
  testId: string
  status: string
  active: boolean
  edited: boolean
  operator: string | null
  placeholderLabel?: string
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
  const graphInstanceRef = useRef<ReactFlowInstance<
    Node<GraphNodeData>,
    Edge
  > | null>(null)
  const graphFittedProjectRef = useRef<string | null>(null)
  const graphSizeRef = useRef<string | null>(null)
  const positionCacheRef = useRef<{
    projectId: string | null
    positions: Map<string, { x: number; y: number }>
  }>({ projectId: null, positions: new Map() })
  const [revealArchived, setRevealArchived] = useState(
    () => new URLSearchParams(window.location.search).get('reveal') === '1',
  )
  const [view, setView] = useState<'graph' | 'lens'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'lens'
      ? 'lens'
      : 'graph',
  )
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
  const renderedGraph = useMemo(
    () =>
      buildRenderedGraph(
        projectData?.nodes ?? [],
        projectData?.edges ?? [],
        revealArchived,
      ),
    [projectData, revealArchived],
  )
  const selectedRenderedNode = renderedGraph.nodes.find(
    (item) => item.node.id === selectedNodeId,
  )
  const selectedNode =
    selectedRenderedNode && !selectedRenderedNode.placeholder
      ? projectData?.nodes.find((node) => node.id === selectedNodeId)
      : undefined
  const selectedCandidate = selectedNode?.candidateId
    ? (projectData?.candidates.find(
        (candidate) => candidate.id === selectedNode.candidateId,
      ) ?? null)
    : null

  const graphNodes = useMemo(() => {
    if (!projectData) return []
    if (positionCacheRef.current.projectId !== projectData.project.id) {
      positionCacheRef.current = {
        projectId: projectData.project.id,
        positions: new Map(),
      }
    }
    const positions = positionCacheRef.current.positions
    const visible = renderedGraph.nodes.map(({ node }) => node)
    const graphEdges: Edge[] = renderedGraph.edges.map((edge) => ({
      id: edge.id,
      source: edge.parentId,
      target: edge.childId,
    }))
    const rawNodes: Node<GraphNodeData>[] = renderedGraph.nodes.map(
      ({ node, placeholder }) => {
        if (placeholder) {
          const state = node.status === 'REJECTED' ? 'rejected' : 'archived'
          const label = `Hidden direction · ${state}`
          return {
            id: node.id,
            type: 'graphCard',
            data: {
              title: label,
              subtitle: '',
              root: false,
              testId: 'graph-node-hidden',
              status: node.status,
              active: false,
              edited: false,
              operator: null,
              placeholderLabel: label,
            },
            position: positions.get(node.id) ?? { x: 0, y: 0 },
            width: 190,
            height: 48,
            selected: false,
            selectable: false,
            draggable: false,
          }
        }
        const candidate = node.candidateId
          ? projectData.candidates.find((item) => item.id === node.candidateId)
          : undefined
        const idea = IdeaContentSchema.safeParse(node.content)
        return {
          id: node.id,
          type: 'graphCard',
          data: {
            title: node.type === 'ROOT_PROMPT' ? 'Your prompt' : node.title,
            subtitle:
              node.type === 'ROOT_PROMPT'
                ? node.summary
                : `${node.operator ?? 'Direction'} · ${idea.success ? idea.data.distance : (candidate?.content.distance ?? 'near')}`,
            root: node.type === 'ROOT_PROMPT',
            testId: `graph-node-${node.type === 'ROOT_PROMPT' ? 'root' : 'idea'}`,
            status: node.status,
            active: projectData.project.activeNodeId === node.id,
            edited: node.userEdited,
            operator: node.operator,
          },
          position: positions.get(node.id) ?? { x: 0, y: 0 },
          width: 252,
          height: node.type === 'ROOT_PROMPT' ? 124 : 112,
          selected: node.id === selectedNodeId,
        }
      },
    )
    const byId = new Map(visible.map((node) => [node.id, node]))
    const visibleOrder = new Map(visible.map((node, index) => [node.id, index]))
    const layout = layoutWithPreservedPositions(
      rawNodes,
      graphEdges,
      positions,
      (left, right) => {
        const leftNode = byId.get(left.id)!
        const rightNode = byId.get(right.id)!
        return (
          leftNode.createdAt.localeCompare(rightNode.createdAt) ||
          (leftNode.displayPosition ?? 0) - (rightNode.displayPosition ?? 0) ||
          visibleOrder.get(left.id)! - visibleOrder.get(right.id)!
        )
      },
    )
    layout.forEach((node) => positions.set(node.id, node.position))
    return layout
  }, [projectData, renderedGraph, selectedNodeId])

  const graphEdges = useMemo<Edge[]>(() => {
    return renderedGraph.edges.map((edge) => ({
      id: edge.id,
      source: edge.parentId,
      target: edge.childId,
    }))
  }, [renderedGraph])

  useEffect(() => {
    const graphContainer = graphContainerRef.current
    if (!graphContainer || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (!width || !height) return
      const size = `${Math.round(width)}x${Math.round(height)}`
      const previousSize = graphSizeRef.current
      graphSizeRef.current = size
      if (previousSize === null || previousSize === size) return
      requestAnimationFrame(() => {
        void graphInstanceRef.current?.fitView({ padding: 0.2 })
      })
    })
    observer.observe(graphContainer)
    return () => observer.disconnect()
  }, [projectData])

  useEffect(() => {
    if (
      !projectData ||
      !graphInstanceRef.current ||
      graphFittedProjectRef.current === projectData.project.id
    )
      return
    const frame = requestAnimationFrame(() => {
      void graphInstanceRef.current?.fitView({ padding: 0.2 })
      graphFittedProjectRef.current = projectData.project.id
    })
    return () => cancelAnimationFrame(frame)
  }, [graphNodes.length, projectData])

  const closeInspector = useCallback(() => {
    if (projectData) updateUrl(projectData.project.id, null)
    setSelectedNodeId(null)
    previousFocusRef.current?.focus()
  }, [projectData])

  const refreshProject = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
  }, [projectId, queryClient])

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
    if (
      renderedGraph.nodes.find((item) => item.node.id === nodeId)?.placeholder
    )
      return
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

  function changeView(next: 'graph' | 'lens') {
    setView(next)
    graphFittedProjectRef.current = null
    const url = new URL(window.location.href)
    if (next === 'lens') url.searchParams.set('view', 'lens')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }

  function toggleRevealArchived() {
    setRevealArchived((current) => {
      const reveal = !current
      const url = new URL(window.location.href)
      if (reveal) url.searchParams.set('reveal', '1')
      else url.searchParams.delete('reveal')
      window.history.replaceState(null, '', url)
      return reveal
    })
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
                      renderedGraph.nodes.filter(
                        ({ node, placeholder }) =>
                          node.type === 'IDEA' && !placeholder,
                      ).length
                    }{' '}
                    directions
                  </p>
                )}
                <div
                  className="view-toggle"
                  role="group"
                  aria-label="Workspace view"
                >
                  <button
                    type="button"
                    aria-pressed={view === 'graph'}
                    onClick={() => changeView('graph')}
                  >
                    Graph
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === 'lens'}
                    onClick={() => changeView('lens')}
                  >
                    Lens
                  </button>
                </div>
                <button
                  type="button"
                  className="secondary-button reveal-toggle"
                  aria-pressed={revealArchived}
                  onClick={toggleRevealArchived}
                >
                  {revealArchived
                    ? 'Hide rejected and archived'
                    : 'Reveal rejected and archived'}
                </button>
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
              {view === 'lens' ? (
                <LensView
                  nodes={renderedGraph.nodes}
                  edges={renderedGraph.edges}
                  focusId={selectedNode?.id ?? projectData.project.activeNodeId}
                  activeNodeId={projectData.project.activeNodeId}
                  withInspector={Boolean(selectedNode)}
                  onOpen={openNode}
                />
              ) : (
                <>
                  <div
                    ref={graphContainerRef}
                    className={`workspace-graph ${selectedNode ? 'with-inspector' : ''}`}
                    data-testid="graph-canvas"
                    aria-label="Idea graph"
                  >
                    <ReactFlow
                      nodes={graphNodes}
                      edges={graphEdges}
                      nodeTypes={nodeTypes}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable={false}
                      onNodeClick={(_, node) => openNode(node.id)}
                      onInit={(instance) => {
                        graphInstanceRef.current = instance
                        if (
                          projectData &&
                          graphFittedProjectRef.current !==
                            projectData.project.id
                        ) {
                          requestAnimationFrame(() => {
                            void instance.fitView({ padding: 0.2 })
                            graphFittedProjectRef.current =
                              projectData.project.id
                          })
                        }
                      }}
                      fitView={false}
                      fitViewOptions={{ padding: 0.2 }}
                      minZoom={0.2}
                      proOptions={{ hideAttribution: true }}
                    >
                      <Background color="#e5e1d7" gap={24} size={1} />
                      <Controls showInteractive={false} />
                    </ReactFlow>
                  </div>
                </>
              )}
              {selectedNode && (
                <Inspector
                  node={selectedNode}
                  candidate={selectedCandidate}
                  isMobile={isMobile}
                  projectId={projectData.project.id}
                  activeNodeId={projectData.project.activeNodeId}
                  mockScenario={mockScenario}
                  useMockScenario={modelMode === 'mock'}
                  onChanged={refreshProject}
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
  if (data.placeholderLabel)
    return (
      <div
        className="graph-hidden-placeholder"
        data-testid={data.testId}
        aria-label={data.placeholderLabel}
      >
        <Handle type="target" position={Position.Top} isConnectable={false} />
        {data.placeholderLabel}
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={false}
        />
      </div>
    )
  return (
    <div
      className={`graph-card status-${data.status.toLowerCase()} ${data.active ? 'is-active' : ''} ${data.edited ? 'is-edited' : ''}`}
      data-testid={data.testId}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <button type="button" aria-label={`Open ${data.title}`}>
        <span className="graph-card-badges">
          {data.active && <span className="state-badge">Active</span>}
          {data.status === 'PINNED' && (
            <span className="state-badge">Pinned</span>
          )}
          {data.status === 'REJECTED' && (
            <span className="state-badge status-rejected">Rejected</span>
          )}
          {data.status === 'ARCHIVED' && (
            <span className="state-badge status-archived">Archived</span>
          )}
          {data.edited && <span className="state-badge">Edited</span>}
        </span>
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
  projectId,
  activeNodeId,
  mockScenario,
  useMockScenario,
  onChanged,
  closeButtonRef,
  onClose,
}: {
  node: GraphNodeDto
  candidate: CandidateDto | null
  isMobile: boolean
  projectId: string
  activeNodeId: string | null
  mockScenario: MockScenario
  useMockScenario: boolean
  onChanged: () => Promise<void>
  closeButtonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const parsedContent = IdeaContentSchema.safeParse(node.content)
  const content = parsedContent.success ? parsedContent.data : null
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
      {content ? (
        <div className="inspector-content">
          <InspectorSection title="Summary">{content.summary}</InspectorSection>
          <InspectorSection title="Preserved intent">
            {content.preservedIntent}
          </InspectorSection>
          <InspectorSection title="Changed assumptions">
            <ul>
              {content.changedAssumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </InspectorSection>
          <InspectorSection title="Why it might fit">
            {content.fitRationale}
          </InspectorSection>
          <InspectorSection title="Strongest objection">
            {content.strongestObjection}
          </InspectorSection>
          <InspectorSection title="First test">
            {content.firstTest}
          </InspectorSection>
          <InspectorSection title="Mechanism">
            {content.mechanism}
          </InspectorSection>
          <InspectorSection title="Facets">
            <div className="facet-list">
              {content.facets.map((facet) => (
                <span key={facet}>{facet}</span>
              ))}
            </div>
          </InspectorSection>
          <InspectorSection title="Hypothesis — not confirmed intent">
            <p>{content.hypothesis.statement}</p>
            <h4>Assumptions</h4>
            <ul>
              {content.hypothesis.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
            <h4>Falsifiers</h4>
            <ul>
              {content.hypothesis.falsifiers.map((falsifier) => (
                <li key={falsifier}>{falsifier}</li>
              ))}
            </ul>
          </InspectorSection>
          {candidate && (
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
          )}
        </div>
      ) : (
        <div className="inspector-content">
          <InspectorSection title="Prompt">{node.summary}</InspectorSection>
        </div>
      )}
      <Stage2Controls
        projectId={projectId}
        node={node}
        activeNodeId={activeNodeId}
        mobile={isMobile}
        mockScenario={mockScenario}
        useMockScenario={useMockScenario}
        onChanged={onChanged}
      />
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
