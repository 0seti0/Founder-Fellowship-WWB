import type { GraphEdgeDto, GraphNodeDto } from '@unfold/shared'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { RenderedGraphNode } from '../lib/renderedGraph'
import { diffWords, splitInheritedTitle, type WordToken } from '../lib/wordDiff'

const OPERATOR_LABEL: Record<string, string> = {
  GROUND: 'Ground',
  REFRAME: 'Reframe',
  LEAP: 'Leap',
  INVERT: 'Invert',
  TRANSPLANT: 'Transplant',
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'

type Row = {
  node: GraphNodeDto
  placeholder: boolean
  depth: number
  index: string
  parentId: string
  titleTokens: WordToken[]
  summaryTokens: WordToken[]
}

type TypeViewProps = {
  nodes: RenderedGraphNode[]
  edges: GraphEdgeDto[]
  projectId: string
  focusId: string | null
  activeNodeId: string | null
  onOpen: (nodeId: string) => void
}

function newWordFrames(operator: string | null): Keyframe[] {
  switch (operator) {
    case 'GROUND':
      return [
        { opacity: 0, transform: 'translateY(-26px) scaleY(1.35)' },
        { opacity: 1, transform: 'translateY(3px) scaleY(0.9)', offset: 0.7 },
        { opacity: 1, transform: 'none' },
      ]
    case 'REFRAME':
      return [
        { opacity: 0, transform: 'perspective(500px) rotateY(-88deg)' },
        { opacity: 1, transform: 'none' },
      ]
    case 'LEAP':
      return [
        {
          opacity: 0,
          transform: 'translate(-56px, -72px) scale(1.7)',
          filter: 'blur(14px)',
        },
        {
          opacity: 1,
          transform: 'translate(0, -10px) scale(1)',
          filter: 'blur(0)',
          offset: 0.72,
        },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ]
    case 'INVERT':
      return [
        {
          opacity: 0,
          transform: 'perspective(500px) rotateX(180deg)',
          color: '#0b0b0d',
          backgroundColor: '#f2efe8',
        },
        {
          opacity: 1,
          color: '#0b0b0d',
          backgroundColor: '#f2efe8',
          offset: 0.55,
        },
        { opacity: 1, transform: 'none', backgroundColor: 'rgba(0,0,0,0)' },
      ]
    case 'TRANSPLANT':
      return [
        { opacity: 0, transform: 'translateX(64px)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ]
    default:
      return [
        { opacity: 0, transform: 'translateY(12px)', filter: 'blur(10px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ]
  }
}

function animateRowIn(
  row: HTMLElement,
  source: HTMLElement | null,
  delay: number,
  operator: string | null,
) {
  row
    .querySelectorAll<HTMLElement>('.type-row-meta, .type-rule')
    .forEach((element) =>
      element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 500,
        delay,
        fill: 'backwards',
      }),
    )
  let carried = 0
  row
    .querySelectorAll<HTMLElement>('.type-title .w-kept[data-src]')
    .forEach((word) => {
      const origin = source?.querySelector<HTMLElement>(
        `.w[data-i="${word.dataset.src}"]`,
      )
      if (!origin) return
      const from = origin.getBoundingClientRect()
      const to = word.getBoundingClientRect()
      if (!to.height) return
      const scale = from.height / to.height
      word.animate(
        [
          {
            transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`,
            color: '#f3d48b',
          },
          { color: '#f3d48b', offset: 0.8 },
          { transform: 'none' },
        ],
        {
          duration: 1150,
          delay: delay + carried * 70,
          easing: EASE_IN_OUT,
          fill: 'backwards',
        },
      )
      origin.animate(
        [{ color: '#f3d48b', textShadow: '0 0 18px #f3d48b88' }, {}],
        { duration: 1400, delay: delay + carried * 70 },
      )
      carried += 1
    })

  const fresh = row.querySelectorAll<HTMLElement>(
    '.type-title .w-new, .type-title .w-neutral',
  )
  const frames = newWordFrames(operator)
  const freshDelay = delay + (carried ? 520 : 120)
  fresh.forEach((word, index) =>
    word.animate(frames, {
      duration: operator === 'LEAP' ? 1100 : 820,
      delay: freshDelay + index * 34,
      easing: EASE_OUT,
      fill: 'backwards',
    }),
  )
  row.querySelectorAll<HTMLElement>('.type-summary').forEach((element) =>
    element.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 700,
        delay: freshDelay + fresh.length * 34 + 120,
        easing: EASE_OUT,
        fill: 'backwards',
      },
    ),
  )
}

function Words({
  tokens,
  litKeys,
  indexed,
}: {
  tokens: WordToken[]
  litKeys: Set<string> | null
  indexed?: boolean
}) {
  return tokens.map((token, index) => (
    <span key={index}>
      {index > 0 && ' '}
      <span
        className={`w w-${token.kind} ${litKeys?.has(token.key) ? 'is-lit' : ''}`}
        data-i={indexed ? index : undefined}
        data-src={token.sourceIndex ?? undefined}
      >
        {token.text}
      </span>
    </span>
  ))
}

export default function TypeView({
  nodes,
  edges,
  projectId,
  focusId,
  activeNodeId,
  onOpen,
}: TypeViewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLParagraphElement>(null)
  const motionRef = useRef<{
    projectId: string | null
    seen: Set<string>
    tops: Map<string, number>
  }>({ projectId: null, seen: new Set(), tops: new Map() })
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [hoverRowId, setHoverRowId] = useState<string | null>(null)

  const root = nodes.find(({ node }) => node.type === 'ROOT_PROMPT')?.node
  const prompt =
    (typeof root?.content.prompt === 'string' && root.content.prompt) ||
    root?.summary ||
    ''

  const rows = useMemo(() => {
    const byId = new Map(nodes.map((item) => [item.node.id, item]))
    const children = new Map<string, string[]>()
    for (const edge of [...edges].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )) {
      if (!byId.has(edge.childId)) continue
      children.set(edge.parentId, [
        ...(children.get(edge.parentId) ?? []),
        edge.childId,
      ])
    }
    const result: Row[] = []
    const visited = new Set<string>()
    const visit = (parentId: string, depth: number, prefix: string) => {
      const parent = byId.get(parentId)?.node
      const ordered = [...(children.get(parentId) ?? [])].sort(
        (left, right) => {
          const a = byId.get(left)!.node
          const b = byId.get(right)!.node
          return (
            (a.displayPosition ?? 0) - (b.displayPosition ?? 0) ||
            a.createdAt.localeCompare(b.createdAt)
          )
        },
      )
      ordered.forEach((childId, position) => {
        if (visited.has(childId)) return
        visited.add(childId)
        const item = byId.get(childId)!
        const index =
          depth === 1
            ? String(position + 1).padStart(2, '0')
            : `${prefix}.${position + 1}`
        const parentTitle =
          !parent || parent.type === 'ROOT_PROMPT' ? prompt : parent.title
        const parentSummary =
          !parent || parent.type === 'ROOT_PROMPT' ? prompt : parent.summary
        const own =
          depth === 1
            ? item.node.title
            : splitInheritedTitle(item.node.title, parentTitle).own
        result.push({
          node: item.node,
          placeholder: item.placeholder,
          depth,
          index,
          parentId,
          titleTokens: diffWords(parentTitle, own),
          summaryTokens: diffWords(parentSummary, item.node.summary),
        })
        visit(childId, depth + 1, index)
      })
    }
    if (root) visit(root.id, 1, '')
    return result
  }, [nodes, edges, prompt, root])

  const promptTokens = useMemo(() => diffWords('', prompt), [prompt])
  const carriedCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.depth !== 1 || row.placeholder) continue
      const keys = new Set(
        [...row.titleTokens, ...row.summaryTokens]
          .filter(({ kind }) => kind === 'kept')
          .map(({ key }) => key),
      )
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [rows])
  const directionCount = rows.filter(
    ({ depth, placeholder }) => depth === 1 && !placeholder,
  ).length

  const path = useMemo(() => {
    const parentOf = new Map(edges.map((edge) => [edge.childId, edge.parentId]))
    const ids = new Set<string>()
    let cursor = focusId
    while (cursor && !ids.has(cursor)) {
      ids.add(cursor)
      cursor = parentOf.get(cursor) ?? null
    }
    return ids
  }, [edges, focusId])

  const hoverRow = rows.find(({ node }) => node.id === hoverRowId)
  const litKeys = hoverKey
    ? new Set([hoverKey])
    : hoverRow
      ? new Set(
          [...hoverRow.titleTokens, ...hoverRow.summaryTokens]
            .filter(({ kind }) => kind === 'kept')
            .map(({ key }) => key),
        )
      : null

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const motion = motionRef.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rowElement = (id: string) =>
      stage.querySelector<HTMLElement>(`[data-row-id="${id}"]`)

    if (motion.projectId !== projectId) {
      motion.projectId = projectId
      motion.seen = new Set(rows.map(({ node }) => node.id))
      motion.tops = new Map()
      if (!reduce && rows.length) {
        const words =
          promptRef.current?.querySelectorAll<HTMLElement>('.w') ?? []
        words.forEach((word, index) =>
          word.animate(
            [
              {
                opacity: 0,
                transform: 'translateY(22px)',
                filter: 'blur(14px)',
              },
              { opacity: 1, transform: 'none', filter: 'blur(0)' },
            ],
            {
              duration: 1000,
              delay: index * 45,
              easing: EASE_OUT,
              fill: 'backwards',
            },
          ),
        )
        const start = 500 + words.length * 45
        rows
          .filter(({ depth }) => depth === 1)
          .forEach((row, index) => {
            const element = rowElement(row.node.id)
            if (element)
              animateRowIn(
                element,
                promptRef.current,
                start + index * 320,
                null,
              )
          })
      }
    } else {
      const fresh = rows.filter(({ node }) => !motion.seen.has(node.id))
      for (const row of fresh) motion.seen.add(row.node.id)
      if (!reduce) {
        for (const row of rows) {
          const element = rowElement(row.node.id)
          const before = motion.tops.get(row.node.id)
          if (!element || before === undefined) continue
          const delta = before - element.offsetTop
          if (Math.abs(delta) > 1)
            element.animate(
              [{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
              { duration: 520, easing: EASE_OUT },
            )
        }
        fresh.forEach((row, index) => {
          const element = rowElement(row.node.id)
          const parent = rowElement(row.parentId)
          if (!element) return
          animateRowIn(
            element,
            parent?.querySelector<HTMLElement>('.type-title') ??
              promptRef.current,
            180 + index * 240,
            row.node.operator,
          )
        })
      }
      if (fresh[0])
        rowElement(fresh[0].node.id)?.scrollIntoView({
          block: 'nearest',
          behavior: reduce ? 'auto' : 'smooth',
        })
    }
    for (const row of rows) {
      const element = rowElement(row.node.id)
      if (element) motion.tops.set(row.node.id, element.offsetTop)
    }
  }, [rows, projectId])

  return (
    <div
      ref={stageRef}
      className="type-stage"
      data-testid="type-view"
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        event.currentTarget.style.setProperty(
          '--mx',
          `${event.clientX - bounds.left}px`,
        )
        event.currentTarget.style.setProperty(
          '--my',
          `${event.clientY - bounds.top + event.currentTarget.scrollTop}px`,
        )
      }}
    >
      <header className="type-prompt-block">
        <div className="type-eyebrow-row">
          <p className="type-eyebrow">Prompt</p>
          <p className="type-eyebrow type-count">{directionCount} directions</p>
        </div>
        <p
          ref={promptRef}
          className="type-prompt"
          style={
            {
              '--prompt-size':
                prompt.length > 180
                  ? '1.7rem'
                  : prompt.length > 110
                    ? '2.1rem'
                    : '2.6rem',
            } as CSSProperties
          }
        >
          {promptTokens.map((token, index) => {
            const count = carriedCount.get(token.key) ?? 0
            return (
              <span key={index}>
                {index > 0 && ' '}
                <span
                  className={`w ${count ? 'is-carried' : ''} ${litKeys?.has(token.key) ? 'is-lit' : ''}`}
                  data-i={index}
                  style={{ '--carried': count } as CSSProperties}
                  onPointerEnter={() => count && setHoverKey(token.key)}
                  onPointerLeave={() => setHoverKey(null)}
                >
                  {token.text}
                </span>
              </span>
            )
          })}
        </p>
        <p className="type-legend" aria-hidden="true">
          <span className="type-legend-kept">Carried from the parent</span>
          <span className="type-legend-new">New in this direction</span>
        </p>
      </header>

      <ol className="type-rows" aria-label="Directions">
        {rows.map((row) => {
          const { node } = row
          const keepsHover =
            !hoverKey ||
            row.titleTokens.some(({ key }) => key === hoverKey) ||
            row.summaryTokens.some(({ key }) => key === hoverKey)
          const distance =
            typeof node.content.distance === 'string'
              ? node.content.distance
              : null
          return (
            <li
              key={node.id}
              data-row-id={node.id}
              className={[
                'type-row',
                `status-${node.status.toLowerCase()}`,
                node.operator ? `op-${node.operator.toLowerCase()}` : '',
                row.depth > 1 ? 'is-nested' : '',
                node.id === focusId ? 'is-focus' : '',
                path.has(node.id) ? 'on-path' : '',
                node.id === activeNodeId ? 'is-active' : '',
                row.placeholder ? 'is-placeholder' : '',
                keepsHover ? '' : 'is-dim',
              ].join(' ')}
              style={{ '--depth': row.depth - 1 } as CSSProperties}
            >
              <span className="type-rule" aria-hidden="true" />
              {row.placeholder ? (
                <div className="type-row-button" data-testid="type-row-hidden">
                  <span className="type-row-meta">
                    <span className="type-index">{row.index}</span>
                    <span className="type-tag">Hidden direction</span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="type-row-button"
                  data-testid="type-row"
                  aria-label={`Open direction: ${node.title}`}
                  aria-current={node.id === focusId ? 'true' : undefined}
                  onClick={() => onOpen(node.id)}
                  onPointerEnter={() => setHoverRowId(node.id)}
                  onPointerLeave={() => setHoverRowId(null)}
                >
                  <span className="type-row-meta">
                    <span className="type-index">{row.index}</span>
                    <span className="type-tag">
                      {node.operator
                        ? OPERATOR_LABEL[node.operator]
                        : (distance ?? 'direction')}
                    </span>
                    {node.status === 'PINNED' && (
                      <span className="type-chip">Pinned</span>
                    )}
                    {node.id === activeNodeId && (
                      <span className="type-chip is-active-chip">Active</span>
                    )}
                    {node.status === 'REJECTED' && (
                      <span className="type-chip">Rejected</span>
                    )}
                    {node.status === 'ARCHIVED' && (
                      <span className="type-chip">Archived</span>
                    )}
                    {node.userEdited && (
                      <span className="type-chip">Edited</span>
                    )}
                  </span>

                  <span className="type-title">
                    <Words tokens={row.titleTokens} litKeys={litKeys} indexed />
                  </span>
                  <span className="type-summary">
                    <Words tokens={row.summaryTokens} litKeys={litKeys} />
                  </span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
