import type { IdeaContent, UnaryOperator } from '@unfold/shared'
import {
  OPERATOR_REGISTRY,
  availableAssumptions,
  isConcreteAssumption,
  type ParentContext,
  type PlanningFeatures,
} from './registry'

export const PLANNING_FEATURES_VERSION = 'planning-v1'
export const SUITABILITY_VERSION = 'suitability-v1'

export type PlanningNode = ParentContext & {
  createdAt: Date | string
}

export type PlanningEdge = {
  parentId: string
  childId: string
  createdAt: Date | string
  id: string
}

function orderKey(value: Date | string) {
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

export function computePlanningFeatures(
  graph: { nodes: PlanningNode[]; edges: PlanningEdge[] },
  parentId: string,
): PlanningFeatures {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const parent = byId.get(parentId)
  if (!parent) throw new Error('Planning parent does not exist in graph')
  const incoming = new Map<string, PlanningEdge[]>()
  const outgoing = new Map<string, PlanningEdge[]>()
  for (const edge of graph.edges) {
    incoming.set(edge.childId, [...(incoming.get(edge.childId) ?? []), edge])
    outgoing.set(edge.parentId, [...(outgoing.get(edge.parentId) ?? []), edge])
  }

  const roots = graph.nodes.filter((node) => node.type === 'ROOT_PROMPT')
  const distance = new Map(roots.map((node) => [node.id, 0]))
  const queue = [...roots]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of outgoing.get(current.id) ?? []) {
      if (distance.has(edge.childId)) continue
      distance.set(edge.childId, distance.get(current.id)! + 1)
      const child = byId.get(edge.childId)
      if (child) queue.push(child)
    }
  }

  const ancestorOperators: UnaryOperator[] = []
  const visited = new Set([parentId])
  let cursor = parent
  while (cursor.type !== 'ROOT_PROMPT') {
    const edge = [...(incoming.get(cursor.id) ?? [])].sort(
      (left, right) =>
        orderKey(left.createdAt) - orderKey(right.createdAt) ||
        left.id.localeCompare(right.id),
    )[0]
    const ancestor = edge ? byId.get(edge.parentId) : undefined
    if (!ancestor || visited.has(ancestor.id)) break
    visited.add(ancestor.id)
    if (ancestor.operator) ancestorOperators.push(ancestor.operator)
    cursor = ancestor
  }

  const children = (outgoing.get(parentId) ?? [])
    .map((edge) => byId.get(edge.childId))
    .filter((node): node is PlanningNode => Boolean(node))
  const content = parent.content as Partial<IdeaContent>
  const assumptions = availableAssumptions(parent)
  const mechanism = String(content.mechanism ?? '').trim()
  const axes = content.hypothesis?.axes
  const projectOperatorCounts: Partial<Record<UnaryOperator, number>> = {}
  for (const node of graph.nodes) {
    if (node.operator)
      projectOperatorCounts[node.operator] =
        (projectOperatorCounts[node.operator] ?? 0) + 1
  }

  return {
    depth: distance.get(parentId) ?? 0,
    ancestorOperators,
    lastOperator: parent.operator,
    projectOperatorCounts,
    operatorsAlreadyAppliedToParent: [
      ...new Set(
        children.flatMap((node) => (node.operator ? [node.operator] : [])),
      ),
    ],
    pinnedCount: graph.nodes.filter((node) => node.status === 'PINNED').length,
    parentPinned: parent.status === 'PINNED',
    parentChildCount: children.length,
    concreteAssumptionCount: assumptions.filter(isConcreteAssumption).length,
    hasAbstractableMechanism:
      mechanism.split(/\s+/).filter(Boolean).length >= 2 &&
      !/\b(?:unclear|unknown|tbd|n\/a|none|todo)\b/i.test(mechanism),
    distance: content.distance ?? null,
    timeHorizon: axes?.timeHorizon ?? null,
    risk: axes?.risk ?? null,
  }
}

export function suitability(
  operator: UnaryOperator,
  features: PlanningFeatures,
) {
  return OPERATOR_REGISTRY[operator].suitability(features)
}
