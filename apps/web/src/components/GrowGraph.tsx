import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GrowEdge, GrowLayout, GrowNode } from '../lib/growGraph'

const PAD = 28

export function GrowGraph({
  layout,
  width,
  height,
}: {
  layout: GrowLayout
  width: number
  height: number
}) {
  const ghosts = useGhosts(layout.nodes)
  const scale = Math.min(
    1,
    (width - PAD * 2) / Math.max(1, layout.width),
    (height - PAD * 2) / Math.max(1, layout.height),
  )
  const x = (width - layout.width * scale) / 2
  const y = (height - layout.height * scale) / 2
  const byKey = new Map(
    [...ghosts, ...layout.nodes].map((node) => [node.key, node]),
  )
  return (
    <div
      className="p-grow"
      style={{ width, height }}
      data-testid="grow-graph"
      aria-hidden="true"
    >
      <div
        className="p-grow-camera"
        style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
      >
        <svg
          className="p-grow-edges"
          width={Math.max(1, layout.width)}
          height={Math.max(1, layout.height)}
        >
          {layout.edges.map((edge) => (
            <Edge key={edge.key} edge={edge} nodes={byKey} />
          ))}
        </svg>
        {ghosts.map((node) => (
          <Node key={`ghost:${node.key}`} node={node} exiting />
        ))}
        {layout.nodes.map((node) => (
          <Node key={node.key} node={node} exiting={false} />
        ))}
      </div>
    </div>
  )
}

function useGhosts(nodes: GrowNode[]) {
  const [ghosts, setGhosts] = useState<GrowNode[]>([])
  const previous = useRef<GrowNode[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => {
    const keys = new Set(nodes.map((node) => node.key))
    const gone = previous.current.filter(
      (node) => !keys.has(node.key) && !node.key.startsWith('pending:'),
    )
    previous.current = nodes
    setGhosts((current) => {
      const kept = current.filter((node) => !keys.has(node.key))
      return gone.length ? [...kept, ...gone] : kept
    })
    if (!gone.length) return
    timers.current.push(
      window.setTimeout(
        () => setGhosts((current) => current.filter((g) => !gone.includes(g))),
        900,
      ),
    )
  }, [nodes])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((id) => window.clearTimeout(id))
  }, [])
  return ghosts
}

function Edge({
  edge,
  nodes,
}: {
  edge: GrowEdge
  nodes: Map<string, GrowNode>
}) {
  const from = nodes.get(edge.from)
  const to = nodes.get(edge.to)
  if (!from || !to) return null
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const bend = Math.max(30, (x2 - x1) / 2)
  const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
  const dropped = to.state === 'dropped' || to.state === 'other'
  return (
    <path
      className={[
        'p-grow-edge',
        edge.path ? 'is-path' : '',
        edge.pending ? 'is-pending' : '',
        dropped ? 'is-faint' : '',
      ].join(' ')}
      style={{ d: `path('${d}')` } as CSSProperties}
      pathLength={1}
    />
  )
}

const CHIP = ['Intent', 'Useful', 'Specific', 'Testable', 'Fresh']

function Node({ node, exiting }: { node: GrowNode; exiting: boolean }) {
  const label =
    node.state === 'root'
      ? 'Your prompt'
      : node.building
        ? 'Building on this'
        : node.state === 'path'
          ? 'Chosen'
          : node.state === 'draft'
            ? node.writing
              ? 'Writing…'
              : 'Draft'
            : node.state === 'kept'
              ? 'Kept'
              : node.state === 'dropped'
                ? 'Not kept'
                : node.suggested
                  ? 'Suggested'
                  : node.state === 'option'
                    ? 'Option'
                    : ''
  return (
    <div
      className={[
        'p-gnode',
        `is-${node.state}`,
        node.focused ? 'is-focused' : '',
        node.building ? 'is-building' : '',
        exiting ? 'is-exiting' : '',
      ].join(' ')}
      style={{
        width: node.width,
        height: node.height,
        transform: `translate(${node.x}px, ${node.y}px)`,
      }}
    >
      <span className="p-gnode-hd">
        <span>{label}</span>
        {node.scores && (
          <span className="p-gnode-scores">
            {node.scores.map((score, index) => (
              <i
                key={CHIP[index]}
                title={CHIP[index]}
                className={
                  score === null
                    ? ''
                    : score === 2
                      ? 'is-ok'
                      : score === 1
                        ? 'is-mid'
                        : 'is-bad'
                }
              />
            ))}
          </span>
        )}
      </span>
      <span className="p-gnode-title">
        {node.state === 'draft' ? (
          <TypedText text={node.title} caret={node.writing} />
        ) : (
          node.title
        )}
      </span>
    </div>
  )
}

function TypedText({ text, caret }: { text: string; caret: boolean }) {
  const [shown, setShown] = useState(0)
  const target = useRef(text)
  target.current = text
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let count = shown
    const step = (now: number) => {
      const goal = target.current.length
      const rate = Math.max(40, (goal - count) * 4)
      count = Math.min(goal, count + ((now - last) / 1000) * rate)
      last = now
      setShown(Math.floor(count))
      if (count < goal) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // Restart only when the streamed text grows; `shown` is the resume point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  return (
    <>
      {text.slice(0, shown)}
      {caret && <span className="p-caret" />}
    </>
  )
}
