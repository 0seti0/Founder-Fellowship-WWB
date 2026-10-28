import { Html, Line, OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import type { GraphEdgeDto, PromptItemDto } from '@unfold/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  ancestryPath,
  computeCosmosLayout,
  RING_RADIUS,
  type CosmosBody,
} from '../lib/cosmosLayout'
import type { RenderedGraphNode } from '../lib/renderedGraph'

type Vec3 = [number, number, number]

const reduceMotion =
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

const operatorNames: Record<string, string> = {
  GROUND: 'Ground',
  REFRAME: 'Reframe',
  LEAP: 'Leap',
  INVERT: 'Invert',
  TRANSPLANT: 'Transplant',
}

export default function CosmosView({
  nodes,
  edges,
  facts,
  constraints,
  prompt,
  focusId,
  activeNodeId,
  withInspector,
  onOpen,
}: {
  nodes: RenderedGraphNode[]
  edges: GraphEdgeDto[]
  facts: PromptItemDto[]
  constraints: PromptItemDto[]
  prompt: string
  focusId: string | null
  activeNodeId: string | null
  withInspector: boolean
  onOpen: (nodeId: string) => void
}) {
  const bodies = useMemo(
    () =>
      computeCosmosLayout(
        nodes.map(({ node, placeholder }) => ({
          id: node.id,
          type: node.type,
          status: node.status,
          operator: node.operator,
          distance: (node.content as { distance?: string }).distance ?? null,
          placeholder,
        })),
        edges,
      ),
    [nodes, edges],
  )
  const byId = useMemo(
    () => new Map(bodies.map((body) => [body.id, body])),
    [bodies],
  )
  const nodeById = useMemo(
    () => new Map(nodes.map((item) => [item.node.id, item])),
    [nodes],
  )
  const rootId =
    nodes.find(({ node }) => node.type === 'ROOT_PROMPT')?.node.id ?? null
  const rootSeen = useRef<{ id: string | null; at: number }>({
    id: null,
    at: 0,
  })
  if (rootSeen.current.id !== rootId)
    rootSeen.current = { id: rootId, at: performance.now() }

  const focus =
    (focusId ? byId.get(focusId) : undefined) ??
    (rootId ? byId.get(rootId) : undefined)
  const thread = ancestryPath(edges, focus?.id ?? null)
    .map((id) => byId.get(id)?.position)
    .filter((point): point is Vec3 => Boolean(point))
  const threadIds = new Set(ancestryPath(edges, focus?.id ?? null))
  const labelledChildren = new Set(
    edges
      .filter((edge) => edge.parentId === focus?.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map((edge) => edge.childId),
  )
  const hardConstraint = constraints.find((item) => item.strength === 'hard')

  return (
    <div
      className={`workspace-graph cosmos-canvas ${withInspector ? 'with-inspector' : ''}`}
      data-testid="cosmos-canvas"
      aria-label="Cosmos view of the idea graph"
    >
      <Canvas
        camera={{ position: [0, 10, 19], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#04050c']} />
        <ambientLight intensity={0.25} />
        <pointLight position={[0, 0, 0]} intensity={40} color="#ffd9a0" />
        <Stars
          radius={90}
          depth={40}
          count={3500}
          factor={3}
          fade
          speed={0.4}
        />
        <Nebula key={rootId ?? 'none'} />
        <OrbitRings />
        <FactMotes facts={facts} />
        {hardConstraint && <Membrane text={hardConstraint.text} />}
        {bodies.map((body) => {
          if (!body.parentId) return null
          const parent = byId.get(body.parentId)
          if (!parent) return null
          return (
            <Line
              key={`edge-${body.id}`}
              points={[parent.position, body.position]}
              color="#5b6aa8"
              lineWidth={1}
              transparent
              opacity={0.3}
            />
          )
        })}
        {thread.length > 1 && <GoldenThread points={thread} />}
        {bodies.map((body, index) => {
          const rendered = nodeById.get(body.id)
          if (!rendered) return null
          const parent = body.parentId ? byId.get(body.parentId) : undefined
          return (
            <Body
              key={body.id}
              body={body}
              index={index}
              origin={parent?.position ?? [0, 0, 0]}
              firstWave={performance.now() - rootSeen.current.at < 1200}
              title={
                rendered.placeholder
                  ? 'Hidden direction'
                  : body.kind === 'core'
                    ? prompt
                    : rendered.node.title
              }
              edited={rendered.node.userEdited}
              quiet={!threadIds.has(body.id) && !labelledChildren.has(body.id)}
              focused={focus?.id === body.id}
              active={activeNodeId === body.id}
              onOpen={onOpen}
            />
          )
        })}
        <CameraRig
          target={focus?.position ?? [0, 0, 0]}
          distance={!focus || focus.kind === 'core' ? 19 : 10.5}
        />
        <OrbitControls
          makeDefault
          enableDamping
          enablePan={false}
          minDistance={3}
          maxDistance={40}
        />
        <EffectComposer>
          <Bloom
            mipmapBlur
            intensity={1.1}
            luminanceThreshold={0.25}
            luminanceSmoothing={0.3}
          />
        </EffectComposer>
      </Canvas>
      {!reduceMotion && (
        <div className="cosmos-birth" key={rootId ?? 'none'} aria-hidden="true">
          {prompt}
        </div>
      )}
      <div className="cosmos-legend" aria-hidden="true">
        <span className="cosmos-legend-thread">Your path</span>
        {Object.entries(operatorNames).map(([operator, name]) => (
          <span
            key={operator}
            className={`cosmos-chip op-${operator.toLowerCase()}`}
          >
            {name}
          </span>
        ))}
        <span className="cosmos-chip is-star">Pinned star</span>
        <span className="cosmos-chip is-ember">Rejected ember</span>
      </div>
    </div>
  )
}

function Body({
  body,
  index,
  origin,
  firstWave,
  title,
  edited,
  quiet,
  focused,
  active,
  onOpen,
}: {
  body: CosmosBody
  quiet: boolean
  index: number
  origin: Vec3
  firstWave: boolean
  title: string
  edited: boolean
  focused: boolean
  active: boolean
  onOpen: (nodeId: string) => void
}) {
  const group = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const start = useRef<number | null>(null)
  const from = useRef(new THREE.Vector3(...(firstWave ? [0, 0, 0] : origin)))
  const [x, y, z] = body.position
  const target = useMemo(() => new THREE.Vector3(x, y, z), [x, y, z])
  const scratch = useRef(new THREE.Vector3())
  const [born, setBorn] = useState(reduceMotion)
  const operatorBirth =
    !firstWave && body.kind !== 'core' ? body.operator : null
  const delay = firstWave
    ? body.kind === 'core'
      ? 0
      : 1.2 + index * 0.22
    : 0.15
  const duration = operatorBirth === 'LEAP' ? 1.9 : 1.4

  useFrame((state, delta) => {
    const element = group.current
    if (!element) return
    const now = state.clock.elapsedTime
    if (start.current === null) start.current = now + delay
    const t = reduceMotion
      ? 1
      : Math.min(1, Math.max(0, (now - start.current) / duration))
    const eased = 1 - Math.pow(1 - t, 3)
    if (t < 1) {
      scratch.current.lerpVectors(from.current, target, eased)
      if (operatorBirth === 'LEAP')
        scratch.current.y += Math.sin(Math.PI * t) * 4
      if (operatorBirth === 'TRANSPLANT')
        scratch.current.y += Math.sin(Math.PI * t) * 1.6
      element.position.copy(scratch.current)
    } else {
      element.position.lerp(target, 1 - Math.pow(0.002, delta))
      if (!born) setBorn(true)
    }
    const scale =
      operatorBirth === 'GROUND' && t < 1
        ? t < 0.5
          ? eased * 1.7
          : 1.7 - 0.7 * eased
        : eased
    element.scale.setScalar(Math.max(0.001, scale))
    const sphere = mesh.current
    if (sphere) {
      if (operatorBirth === 'REFRAME' && t < 1)
        sphere.rotation.y = (1 - eased) * Math.PI * 5
      else if (operatorBirth === 'INVERT' && t < 1)
        sphere.rotation.x = (1 - eased) * Math.PI * 2
      else if (body.status !== 'ARCHIVED') sphere.rotation.y += delta * 0.3
    }
  })

  const inverted = body.operator === 'INVERT'
  const isCore = body.kind === 'core'
  const badges = [
    active && 'Active',
    body.status === 'PINNED' && 'Pinned star',
    body.status === 'REJECTED' && 'Rejected',
    body.status === 'ARCHIVED' && 'Archived',
    edited && 'Edited',
  ].filter(Boolean) as string[]
  const meta = isCore
    ? 'Your prompt'
    : body.operator
      ? operatorNames[body.operator]
      : 'Direction'

  return (
    <group ref={group} position={firstWave ? [0, 0, 0] : origin}>
      <mesh
        ref={mesh}
        onClick={(event) => {
          event.stopPropagation()
          if (!body.placeholder) onOpen(body.id)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <sphereGeometry args={[body.radius, 48, 48]} />
        <meshStandardMaterial
          color={inverted ? '#12070d' : body.color}
          emissive={body.color}
          emissiveIntensity={inverted ? 0.2 : body.emissive}
          roughness={0.5}
          metalness={0.15}
          transparent={body.placeholder}
          opacity={body.placeholder ? 0.5 : 1}
        />
      </mesh>
      {inverted && (
        <mesh>
          <sphereGeometry args={[body.radius * 1.14, 48, 48]} />
          <meshBasicMaterial
            color={body.color}
            transparent
            opacity={0.45}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
      {body.status === 'PINNED' && (
        <>
          <pointLight color={body.color} intensity={8} distance={7} />
          <mesh>
            <sphereGeometry args={[body.radius * 1.9, 32, 32]} />
            <meshBasicMaterial
              color={body.color}
              transparent
              opacity={0.14}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
      {(active || focused) && !isCore && (
        <PulseRing
          radius={body.radius * 1.7}
          color={active ? '#9ff0c8' : '#ffd27a'}
        />
      )}
      {body.kind === 'seed-system' && (
        <mesh rotation-x={Math.PI / 2}>
          <ringGeometry args={[body.radius * 2.3, body.radius * 2.42, 64]} />
          <meshBasicMaterial
            color={body.color}
            transparent
            opacity={0.45}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {born && (
        <Html
          center
          position={[0, body.radius + (isCore ? 0.9 : 0.55), 0]}
          zIndexRange={[30, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <button
            type="button"
            className={[
              'cosmos-label',
              isCore ? 'is-core' : '',
              focused ? 'is-focus' : '',
              quiet ? 'is-quiet' : '',
              body.operator ? `op-${body.operator.toLowerCase()}` : '',
              `status-${body.status.toLowerCase()}`,
            ].join(' ')}
            disabled={body.placeholder}
            aria-label={`Open ${isCore ? 'your prompt' : title}`}
            data-testid={`cosmos-body-${isCore ? 'core' : body.kind}`}
            onClick={() => onOpen(body.id)}
          >
            <span className="cosmos-label-meta">{meta}</span>
            <span className="cosmos-label-title">
              {body.kind === 'moon' || body.kind === 'seed-system'
                ? title.split(': ').slice(1).join(': ') || title
                : title}
            </span>
            {badges.length > 0 && (
              <span className="cosmos-label-badges">
                {badges.map((badge) => (
                  <span key={badge}>{badge}</span>
                ))}
              </span>
            )}
          </button>
        </Html>
      )}
    </group>
  )
}

function PulseRing({ radius, color }: { radius: number; color: string }) {
  const ring = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    if (!ring.current) return
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.08
    ring.current.scale.setScalar(pulse)
    ring.current.lookAt(state.camera.position)
  })
  return (
    <mesh ref={ring}>
      <ringGeometry args={[radius, radius * 1.08, 64]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

function Nebula() {
  const count = 1800
  const points = useRef<THREE.Points>(null)
  const { start, end } = useMemo(() => {
    const random = mulberry32(7)
    const startPositions = new Float32Array(count * 3)
    const endPositions = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      const far = 10 + random() * 8
      startPositions.set(
        [
          far * Math.sin(phi) * Math.cos(theta),
          far * Math.cos(phi),
          far * Math.sin(phi) * Math.sin(theta),
        ],
        index * 3,
      )
      const near = Math.pow(random(), 1.8) * 2.4
      const arm = theta + near * 1.6
      endPositions.set(
        [
          near * Math.cos(arm),
          (random() - 0.5) * 0.35 * (2.6 - near),
          near * Math.sin(arm),
        ],
        index * 3,
      )
    }
    return { start: startPositions, end: endPositions }
  }, [])
  const positions = useMemo(
    () => new Float32Array(reduceMotion ? end : start),
    [start, end],
  )
  const startedAt = useRef<number | null>(null)
  useFrame((state, delta) => {
    const cloud = points.current
    if (!cloud) return
    if (startedAt.current === null) startedAt.current = state.clock.elapsedTime
    const t = reduceMotion
      ? 1
      : Math.min(1, (state.clock.elapsedTime - startedAt.current) / 2.2)
    if (t < 1 || positions[0] !== end[0]) {
      const eased = 1 - Math.pow(1 - t, 3)
      for (let index = 0; index < positions.length; index += 1)
        positions[index] = start[index]! + (end[index]! - start[index]!) * eased
      cloud.geometry.attributes.position!.needsUpdate = true
    }
    cloud.rotation.y += delta * 0.12
  })
  return (
    <>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.06}
          color="#ffcf7a"
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </>
  )
}

function OrbitRings() {
  return (
    <>
      {Object.entries(RING_RADIUS).map(([label, radius]) => (
        <group key={label}>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[radius - 0.012, radius + 0.012, 160]} />
            <meshBasicMaterial
              color="#8fa3ff"
              transparent
              opacity={0.22}
              side={THREE.DoubleSide}
            />
          </mesh>
          <Html
            position={[radius, 0, 0]}
            center
            zIndexRange={[10, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <span className="cosmos-ring-label">{label}</span>
          </Html>
        </group>
      ))}
    </>
  )
}

function FactMotes({ facts }: { facts: PromptItemDto[] }) {
  const group = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y -= delta * 0.08
  })
  const shown = facts.slice(0, 5)
  return (
    <group ref={group}>
      {shown.map((fact, index) => {
        const angle = (index / Math.max(1, shown.length)) * Math.PI * 2
        const position: Vec3 = [
          Math.cos(angle) * 2.6,
          0.5,
          Math.sin(angle) * 2.6,
        ]
        return (
          <group key={fact.id} position={position}>
            <mesh>
              <sphereGeometry args={[0.07, 16, 16]} />
              <meshBasicMaterial color="#fff2c4" />
            </mesh>
            <Html
              center
              position={[0, 0.3, 0]}
              zIndexRange={[10, 0]}
              style={{ pointerEvents: 'none' }}
            >
              <span className="cosmos-fact">{truncate(fact.text, 44)}</span>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

function Membrane({ text }: { text: string }) {
  const shell = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (shell.current) shell.current.rotation.y += delta * 0.03
  })
  return (
    <group>
      <mesh ref={shell}>
        <icosahedronGeometry args={[12, 2]} />
        <meshBasicMaterial
          color="#7ad7ff"
          wireframe
          transparent
          opacity={0.018}
        />
      </mesh>
      <Html
        position={[0, 12.4, 0]}
        center
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <span className="cosmos-membrane">
          Hard constraint · {truncate(text, 60)}
        </span>
      </Html>
    </group>
  )
}

function GoldenThread({ points }: { points: Vec3[] }) {
  const line = useRef<{ material: { dashOffset: number } } | null>(null)
  useFrame((_, delta) => {
    if (line.current && !reduceMotion)
      line.current.material.dashOffset -= delta * 0.6
  })
  return (
    <>
      <Line
        points={points}
        color="#ffb84a"
        lineWidth={7}
        transparent
        opacity={0.18}
      />
      <Line
        ref={line as never}
        points={points}
        color="#ffe3a3"
        lineWidth={2.4}
        dashed
        dashSize={0.35}
        gapSize={0.2}
      />
    </>
  )
}

function CameraRig({ target, distance }: { target: Vec3; distance: number }) {
  const controls = useThree((state) => state.controls) as unknown as {
    target: THREE.Vector3
    update: () => void
  } | null
  const camera = useThree((state) => state.camera)
  const flyUntil = useRef(0)
  const key = target.map((value) => value.toFixed(2)).join(',')
  useEffect(() => {
    flyUntil.current = performance.now() + 1800
  }, [key, distance])
  useFrame((_, delta) => {
    if (!controls || performance.now() > flyUntil.current) return
    const k = reduceMotion ? 1 : 1 - Math.pow(0.03, delta)
    controls.target.lerp(new THREE.Vector3(...target), k)
    const direction = camera.position.clone().sub(controls.target).normalize()
    camera.position.lerp(
      controls.target.clone().add(direction.multiplyScalar(distance)),
      k,
    )
    controls.update()
  })
  return null
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function mulberry32(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
