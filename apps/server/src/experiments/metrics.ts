export type FunctionalEquivalenceVerdict =
  'equivalent' | 'related_but_distinct' | 'distinct'

export type ExperimentMetricCandidate = {
  id: string
  qualityScore: number
  eligibility: 'ELIGIBLE' | 'REJECTED'
}

export type ExperimentComparison = {
  leftId: string
  rightId: string
  verdict: FunctionalEquivalenceVerdict
  similarity: number | null
}

export type EmbeddingSimilarityPair = {
  leftId: string
  rightId: string
  similarity: number | null
}

const verdicts: FunctionalEquivalenceVerdict[] = [
  'equivalent',
  'related_but_distinct',
  'distinct',
]

export function calculateExperimentMetrics(
  candidates: ExperimentMetricCandidate[],
  comparisons: ExperimentComparison[],
  selectedIds: string[],
  embeddingSimilarities: EmbeddingSimilarityPair[] = comparisons,
) {
  const parent = new Map(
    candidates.map((candidate) => [candidate.id, candidate.id]),
  )
  const find = (id: string): string => {
    const current = parent.get(id)
    if (!current) return id
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const union = (left: string, right: string) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }

  for (const comparison of comparisons) {
    if (
      comparison.verdict === 'equivalent' &&
      parent.has(comparison.leftId) &&
      parent.has(comparison.rightId)
    ) {
      union(comparison.leftId, comparison.rightId)
    }
  }

  const eligibleIds = candidates
    .filter((candidate) => candidate.eligibility === 'ELIGIBLE')
    .map((candidate) => candidate.id)
  const slateIds = [...new Set(selectedIds)].filter((id) => parent.has(id))
  const classesAmong = (ids: string[]) =>
    new Set(ids.map((id) => find(id))).size
  const counts = Object.fromEntries(
    verdicts.map((verdict) => [verdict, 0]),
  ) as Record<FunctionalEquivalenceVerdict, number>
  for (const comparison of comparisons) counts[comparison.verdict] += 1
  const comparisonCount = comparisons.length
  const proportions = Object.fromEntries(
    verdicts.map((verdict) => [
      verdict,
      comparisonCount ? counts[verdict] / comparisonCount : 0,
    ]),
  ) as Record<FunctionalEquivalenceVerdict, number>

  const slateSet = new Set(slateIds)
  const slateSimilarities = embeddingSimilarities.flatMap((comparison) =>
    slateSet.has(comparison.leftId) &&
    slateSet.has(comparison.rightId) &&
    comparison.similarity !== null &&
    Number.isFinite(comparison.similarity)
      ? [comparison.similarity]
      : [],
  )
  const mean = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null
  const allQ = candidates.map((candidate) => candidate.qualityScore)
  const selectedQ = candidates
    .filter((candidate) => slateSet.has(candidate.id))
    .map((candidate) => candidate.qualityScore)

  return {
    distinctAtK: classesAmong(slateIds),
    effectiveDistinctAtK: classesAmong(eligibleIds),
    pairwiseRedundancy: {
      counts,
      proportions,
      comparedPairs: comparisonCount,
    },
    slateEmbeddingSimilarity: {
      mean: mean(slateSimilarities),
      max: slateSimilarities.length ? Math.max(...slateSimilarities) : null,
      comparedPairs: slateSimilarities.length,
    },
    meanQ: {
      allCandidates: mean(allQ),
      selectedSlate: mean(selectedQ),
    },
  }
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) return null
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null
  return dot / Math.sqrt(leftMagnitude * rightMagnitude)
}
