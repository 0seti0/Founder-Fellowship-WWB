import type { GraphEdgeDto, GraphNodeDto } from '@unfold/shared'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { computeLensLayout, curvePath, type LensItem } from '../lib/lensLayout'
import type { RenderedGraphNode } from '../lib/renderedGraph'

const operatorNames: Record<string, string> = {
  GROUND: 'Ground',
  REFRAME: 'Reframe',
  LEAP: 'Leap',
  INVERT: 'Invert',
  TRANSPLANT: 'Transplant',
}

export function LensView({
  nodes,
  edges,
  focusId,
  activeNodeId,
  withInspector,
  onOpen,
}: {
  nodes: RenderedGraphNode[]
  edges: GraphEdgeDto[]
  focusId: string | null
  activeNodeId: string | null
  withInspector: boolean
  onOpen: (nodeId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 900, height: 600 })
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const seenRef = useRef<{ rootId: string | null; ids: Set<string> }>({
    rootId: null,
    ids: new Set(),
  })
  const previousItemsRef = useRef(new Map<string, LensItem>())

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) =>
        Math.round(current.width) === Math.round(width) &&
        Math.round(current.height) === Math.round(height)
          ? current
          : { width, height },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const nodeById = useMemo(
    () => new Map(nodes.map((item) => [item.node.id, item])),
    [nodes],
  )
  const layout = useMemo(
    () =>
      computeLensLayout(
        nodes.map(({ node }) => node),
        edges,
        focusId,
        size,
      ),
    [nodes, edges, focusId, size],
  )
  const itemById = useMemo(
    () => new Map(layout.items.map((item) => [item.id, item])),
    [layout],
  )

  useLayoutEffect(() => {
    const rootId =
      nodes.find(({ node }) => node.type === 'ROOT_PROMPT')?.node.id ?? null
    const seen = seenRef.current
    const firstPaint = seen.rootId !== rootId
    if (firstPaint) seenRef.current = { rootId, ids: new Set() }
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches
    layout.items.forEach((item, index) => {
      const element = cardRefs.current.get(item.id)
      if (!element || seenRef.current.ids.has(item.id)) return
      seenRef.current.ids.add(item.id)
      if (reduceMotion || typeof element.animate !== 'function') return
      const node = nodeById.get(item.id)?.node
      const parentId = layout.parentOf.get(item.id)
      const origin =
        (parentId &&
          (itemById.get(parentId) ?? previousItemsRef.current.get(parentId))) ||
        null
      if (firstPaint || !node?.operator || !origin) {
        element.animate(
          [
            { opacity: 0, transform: transformFor(item, 'translateY(14px)') },
            { opacity: 1, transform: transformFor(item) },
          ],
          {
            duration: 520,
            delay: index * 45,
            easing: 'ease-out',
            fill: 'backwards',
          },
        )
        return
      }
      element.animate(operatorKeyframes(node.operator, item, origin), {
        duration: node.operator === 'LEAP' ? 1100 : 950,
        delay: index * 70,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'backwards',
      })
    })
    previousItemsRef.current = new Map(itemById)
  }, [layout, itemById, nodeById, nodes])

  const linkPaths = layout.links.flatMap((link) => {
    const from = itemById.get(link.from)
    const to = itemById.get(link.to)
    if (!from || !to) return []
    return [
      {
        key: `${link.from}-${link.to}`,
        d: curvePath([
          { x: from.x, y: from.y },
          { x: to.x, y: to.y },
        ]),
      },
    ]
  })
  const threadPath = curvePath(layout.thread)

  return (
    <div
      ref={containerRef}
      className={`workspace-graph lens-canvas ${withInspector ? 'with-inspector' : ''}`}
      data-testid="lens-canvas"
      aria-label="Focus lens"
    >
      <svg
        className="lens-links"
        width={size.width}
        height={size.height}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="lens-thread-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f3d27a" />
            <stop offset="55%" stopColor="#d9a43a" />
            <stop offset="100%" stopColor="#b97a12" />
          </linearGradient>
          <filter
            id="lens-thread-blur"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {linkPaths.map((link) => (
          <path key={link.key} className="lens-link" d={link.d} />
        ))}
        {threadPath && (
          <>
            <path
              className="lens-thread-glow"
              d={threadPath}
              filter="url(#lens-thread-blur)"
            />
            <path className="lens-thread" d={threadPath} />
            <path className="lens-thread-spark" d={threadPath} />
          </>
        )}
      </svg>
      {layout.items.map((item) => {
        const rendered = nodeById.get(item.id)
        if (!rendered) return null
        return (
          <LensCard
            key={item.id}
            item={item}
            node={rendered.node}
            placeholder={rendered.placeholder}
            active={rendered.node.id === activeNodeId}
            onOpen={onOpen}
            cardRef={(element) => {
              if (element) cardRefs.current.set(item.id, element)
              else cardRefs.current.delete(item.id)
            }}
          />
        )
      })}
      <div className="lens-legend" aria-hidden="true">
        <span className="lens-legend-thread">Path to focus</span>
        {Object.entries(operatorNames).map(([operator, name]) => (
          <span
            key={operator}
            className={`lens-legend-chip op-${operator.toLowerCase()}`}
          >
            {name}
          </span>
        ))}
      </div>
      {layout.offstageCount > 0 && (
        <p className="lens-offstage">
          {layout.offstageCount} more{' '}
          {layout.offstageCount === 1 ? 'direction' : 'directions'} outside the
          lens
        </p>
      )}
    </div>
  )
}

function LensCard({
  item,
  node,
  placeholder,
  active,
  onOpen,
  cardRef,
}: {
  item: LensItem
  node: GraphNodeDto
  placeholder: boolean
  active: boolean
  onOpen: (nodeId: string) => void
  cardRef: (element: HTMLButtonElement | null) => void
}) {
  const root = node.type === 'ROOT_PROMPT'
  const content = node.content as { distance?: string; firstTest?: string }
  const operator = node.operator ? operatorNames[node.operator] : null
  const meta = root
    ? 'Your prompt'
    : `${operator ?? 'Direction'}${content.distance ? ` · ${content.distance}` : ''}`
  const badges = [
    active && 'Active',
    node.status === 'PINNED' && 'Pinned',
    node.status === 'REJECTED' && 'Rejected',
    node.status === 'ARCHIVED' && 'Archived',
    node.userEdited && 'Edited',
  ].filter(Boolean) as string[]
  const title = placeholder
    ? `Hidden direction · ${node.status === 'ARCHIVED' ? 'archived' : 'rejected'}`
    : root
      ? node.summary
      : node.title
  return (
    <button
      ref={cardRef}
      type="button"
      className={[
        'lens-card',
        `role-${item.role}`,
        `status-${node.status.toLowerCase()}`,
        node.operator ? `op-${node.operator.toLowerCase()}` : 'op-none',
        root ? 'is-root' : '',
        active ? 'is-active' : '',
        placeholder ? 'is-placeholder' : '',
      ].join(' ')}
      style={{
        width: item.width,
        height: item.height,
        transform: transformFor(item),
        zIndex: item.role === 'focus' ? 3 : item.role === 'ancestor' ? 2 : 1,
      }}
      disabled={placeholder}
      aria-label={
        placeholder ? title : `Focus ${root ? 'your prompt' : node.title}`
      }
      data-testid={`lens-card-${item.role}`}
      onClick={() => onOpen(node.id)}
    >
      <span className="lens-card-meta">{meta}</span>
      <span className="lens-card-title">{title}</span>
      {item.role === 'focus' && !root && !placeholder && (
        <span className="lens-card-summary">{node.summary}</span>
      )}
      {badges.length > 0 && (
        <span className="lens-card-badges">
          {badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </span>
      )}
    </button>
  )
}

function transformFor(item: LensItem, extra = '', scale = item.scale) {
  return `translate(${(item.x - item.width / 2).toFixed(1)}px, ${(item.y - item.height / 2).toFixed(1)}px) ${extra} scale(${scale.toFixed(3)})`
}

function operatorKeyframes(operator: string, item: LensItem, origin: LensItem) {
  const atOrigin = (extra = '', scale = item.scale * 0.35) =>
    transformFor({ ...item, x: origin.x, y: origin.y }, extra, scale)
  const final = transformFor(item)
  switch (operator) {
    case 'GROUND':
      return [
        { transform: atOrigin(), opacity: 0 },
        {
          transform: transformFor(item, 'translateY(-70px)', item.scale * 0.9),
          opacity: 1,
          offset: 0.45,
        },
        {
          transform: transformFor(item, 'translateY(10px)', item.scale * 1.04),
          offset: 0.78,
        },
        { transform: final, opacity: 1 },
      ]
    case 'REFRAME':
      return [
        { transform: atOrigin('rotate(-160deg)'), opacity: 0 },
        {
          transform: transformFor(item, 'rotate(12deg)', item.scale * 1.05),
          opacity: 1,
          offset: 0.7,
        },
        { transform: final, opacity: 1 },
      ]
    case 'LEAP': {
      const middle = {
        ...item,
        x: (origin.x + item.x) / 2,
        y: Math.min(origin.y, item.y) - 220,
      }
      return [
        { transform: atOrigin(), opacity: 0 },
        {
          transform: transformFor(middle, 'rotate(-8deg)', item.scale * 1.15),
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: transformFor(item, 'rotate(2deg)', item.scale * 0.96),
          offset: 0.85,
        },
        { transform: final, opacity: 1 },
      ]
    }
    case 'INVERT':
      return [
        {
          transform: atOrigin('perspective(900px) rotateY(180deg)'),
          opacity: 0,
        },
        {
          transform: transformFor(item, 'perspective(900px) rotateY(90deg)'),
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: transformFor(item, 'perspective(900px) rotateY(-12deg)'),
          offset: 0.85,
        },
        {
          transform: transformFor(item, 'perspective(900px) rotateY(0deg)'),
          opacity: 1,
        },
      ]
    case 'TRANSPLANT':
      return [
        { transform: atOrigin('', item.scale * 0.9), opacity: 0.2 },
        {
          transform: atOrigin('translateY(-46px)', item.scale * 1.1),
          opacity: 1,
          offset: 0.35,
        },
        {
          transform: transformFor(item, 'translateY(-46px)', item.scale * 1.1),
          offset: 0.75,
        },
        { transform: final, opacity: 1 },
      ]
    default:
      return [
        { transform: atOrigin(), opacity: 0 },
        { transform: final, opacity: 1 },
      ]
  }
}
