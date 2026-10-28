import { z } from 'zod'

export const ModelModeSchema = z.enum(['mock', 'live'])
export const UnaryOperatorSchema = z.enum([
  'GROUND',
  'REFRAME',
  'LEAP',
  'INVERT',
  'TRANSPLANT',
])
export const GenerationStrategySchema = z.enum([
  'JOINT_AXIS_V1',
  'JOINT_AXIS_FREE_V1',
  'INDEPENDENT_SAME_PROMPT_V1',
  'PARAPHRASE_ENSEMBLE_V1',
  'PARAPHRASE_RANDOM_STRING_V1',
  'SSOT_V1',
])
export const NodeStatusSchema = z.enum([
  'VISIBLE',
  'PINNED',
  'REJECTED',
  'ARCHIVED',
])

export const HealthStatusSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('unfold-server'),
  modelMode: ModelModeSchema,
  time: z.iso.datetime(),
})

export const DbHealthSchema = z.object({
  status: z.literal('ok'),
  migrationsApplied: z.number().int().min(0),
})

export const MockScenarioSchema = z.enum([
  'default',
  'malformed',
  'malformed-once',
  'invalid-evidence',
  'invalid-evidence-once',
  'paraphrase',
  'hard-violation',
  'duplicates',
  'low-quality',
  'few-pass',
  'none-pass',
  'weak-diverse',
  'operator-mismatch',
  'operator-gaps',
  'provider-error',
  'timeout',
  'embedding-failure',
])

export const AxesSchema = z
  .object({
    goal: z.string(),
    beneficiary: z.string(),
    motivation: z.string(),
    mechanism: z.string(),
    timeHorizon: z.enum(['immediate', 'months', 'years']),
    risk: z.enum(['low', 'medium', 'high']),
  })
  .strict()

export const ExtractedFactSchema = z
  .object({
    ref: z.string().regex(/^f\d+$/),
    text: z.string().min(1),
    evidence: z.string().min(1),
  })
  .strict()

export const ExtractedConstraintSchema = z
  .object({
    ref: z.string().regex(/^c\d+$/),
    text: z.string().min(1),
    evidence: z.string().min(1),
    strength: z.enum(['hard', 'soft']),
    basis: z.enum(['explicit', 'inferred']),
  })
  .strict()
  .refine(
    (constraint) =>
      constraint.strength !== 'hard' || constraint.basis === 'explicit',
    { message: 'Hard constraints must be explicit' },
  )

export const ExtractionOutputSchema = z
  .object({
    facts: z.array(ExtractedFactSchema),
    constraints: z.array(ExtractedConstraintSchema),
  })
  .strict()

export const HypothesisSchema = z
  .object({
    statement: z.string().min(1),
    axes: AxesSchema.nullable().optional(),
    assumptions: z.array(z.string().min(1)).min(1),
    supportingFactRefs: z.array(z.string().regex(/^f\d+$/)),
    counterevidence: z.array(z.string()),
    falsifiers: z.array(z.string().min(1)).min(1),
  })
  .strict()

export const FrameCandidateSchema = z
  .object({
    key: z.string().min(1),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(600),
    hypothesis: HypothesisSchema,
    preservedIntent: z.string().min(1),
    changedAssumptions: z.array(z.string().min(1)).min(1),
    fitRationale: z.string().min(1),
    strongestObjection: z.string().min(1),
    firstTest: z.string().min(1),
    mechanism: z.string().min(1),
    facets: z.array(z.string().min(1)).min(1).max(6).optional(),
    distance: z.enum(['near', 'adjacent', 'leap']),
  })
  .strict()

export const FrameOutputSchema = z
  .object({
    candidates: z.array(FrameCandidateSchema).min(4).max(8),
  })
  .strict()

export const FrameSingleOutputSchema = z
  .object({
    candidate: FrameCandidateSchema,
  })
  .strict()

export const SsotOutputSchema = z
  .object({
    seed: z.string().min(1).max(64),
    candidate: FrameCandidateSchema,
  })
  .strict()

export const IdeaContentSchema = FrameCandidateSchema.extend({
  invertedAssumption: z.string().trim().min(1).optional(),
  targetContext: z.string().trim().min(1).optional(),
}).strict()

export const ExpansionCandidateSchema = IdeaContentSchema

export const ExpandOutputSchema = z
  .object({
    operator: UnaryOperatorSchema,
    candidates: z.array(ExpansionCandidateSchema).min(4).max(8),
  })
  .strict()

export const EditableIdeaFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().min(1).max(600).optional(),
    preservedIntent: z.string().trim().min(1).optional(),
    changedAssumptions: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(6)
      .optional(),
    fitRationale: z.string().trim().min(1).optional(),
    strongestObjection: z.string().trim().min(1).optional(),
    firstTest: z.string().trim().min(1).optional(),
    mechanism: z.string().trim().min(1).optional(),
    facets: z.array(z.string().trim().min(1)).min(1).max(6).optional(),
  })
  .strict()
  .refine((fields) => Object.keys(fields).length > 0)

export const OperatorOptionSchema = z
  .object({
    operator: UnaryOperatorSchema,
    label: z.string(),
    description: z.string(),
    eligible: z.boolean(),
    code: z.string().nullable(),
    reason: z.string().nullable(),
    suitability: z.number().min(0).max(1),
    suggested: z.boolean(),
    assumptions: z.array(z.string()),
  })
  .strict()

export const EvaluationDimensionSchema = z
  .object({
    label: z.enum(['low', 'medium', 'high']),
    rationale: z.string().min(1),
  })
  .strict()

export const CandidateEvaluationSchema = z
  .object({
    candidateKey: z.string().min(1),
    constraints: z.array(
      z
        .object({
          constraintRef: z.string().regex(/^c\d+$/),
          status: z.enum(['satisfied', 'violated', 'unknown']),
          rationale: z.string().min(1),
        })
        .strict(),
    ),
    intentAlignment: EvaluationDimensionSchema,
    usefulness: EvaluationDimensionSchema,
    specificity: EvaluationDimensionSchema,
  })
  .strict()

export const EvaluateOutputSchema = z
  .object({
    evaluations: z.array(CandidateEvaluationSchema),
  })
  .strict()

export const RubricCriterionSchema = z
  .object({
    score: z.number().int().min(0).max(2),
    rationale: z.string().trim().min(1).max(400),
  })
  .strict()

export const CandidateEvaluationV2Schema = z
  .object({
    candidateKey: z.string().min(1),
    constraints: z.array(
      z
        .object({
          constraintRef: z.string().regex(/^c\d+$/),
          status: z.enum(['satisfied', 'violated', 'unknown']),
          rationale: z.string().min(1),
        })
        .strict(),
    ),
    intentCompatibility: RubricCriterionSchema,
    decisionUsefulness: RubricCriterionSchema,
    specificityCoherence: RubricCriterionSchema,
    firstTestExecutability: RubricCriterionSchema,
    nonObviousness: RubricCriterionSchema,
  })
  .strict()

export const EvaluateOutputV2Schema = z
  .object({
    evaluations: z.array(CandidateEvaluationV2Schema),
  })
  .strict()

export const FunctionalEquivalenceOutputSchema = z
  .object({
    verdict: z.enum(['equivalent', 'related_but_distinct', 'distinct']),
    rationale: z.string().trim().min(1).max(400),
  })
  .strict()

export const LegacyCandidateQualitySchema = z
  .object({
    intentAlignment: EvaluationDimensionSchema,
    usefulness: EvaluationDimensionSchema,
    specificity: EvaluationDimensionSchema,
  })
  .strict()

export const RubricQualitySchema = z
  .object({
    rubricVersion: z.literal('candidate-rubric-v2'),
    criteria: z
      .object({
        intentCompatibility: RubricCriterionSchema.extend({
          weight: z.number(),
        }),
        decisionUsefulness: RubricCriterionSchema.extend({
          weight: z.number(),
        }),
        specificityCoherence: RubricCriterionSchema.extend({
          weight: z.number(),
        }),
        firstTestExecutability: RubricCriterionSchema.extend({
          weight: z.number(),
        }),
        nonObviousness: RubricCriterionSchema.extend({ weight: z.number() }),
      })
      .strict(),
    q: z.number(),
    floor: z
      .object({ passed: z.boolean(), failures: z.array(z.string()) })
      .strict(),
  })
  .strict()

export const CandidateQualitySchema = z.union([
  LegacyCandidateQualitySchema,
  RubricQualitySchema,
])

export const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    originalPrompt: z.string(),
    activeNodeId: z.string().uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const GraphNodeSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    type: z.enum(['ROOT_PROMPT', 'IDEA']),
    origin: z.enum(['PROMPT', 'INITIAL_FRAME', 'OPERATOR_EXPANSION']),
    operator: UnaryOperatorSchema.nullable(),
    runId: z.string().uuid().nullable(),
    candidateId: z.string().uuid().nullable(),
    title: z.string(),
    summary: z.string(),
    content: z.record(z.string(), z.unknown()),
    displayPosition: z.number().int().nullable(),
    status: NodeStatusSchema,
    userEdited: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const GraphEdgeSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    parentId: z.string().uuid(),
    childId: z.string().uuid(),
    runId: z.string().uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export const ConstraintEvaluationDtoSchema = z
  .object({
    constraintRef: z.string(),
    status: z.enum(['satisfied', 'violated', 'unknown']),
    rationale: z.string(),
    text: z.string().optional(),
    strength: z.enum(['hard', 'soft']).optional(),
  })
  .strict()

export const RunProgressStageSchema = z.enum([
  'STARTED',
  'EXTRACTED',
  'FRAMED',
  'EVALUATED',
  'SELECTED',
])

export const RubricCriterionKeySchema = z.enum([
  'intentCompatibility',
  'decisionUsefulness',
  'specificityCoherence',
  'firstTestExecutability',
  'nonObviousness',
])

export const ProgressDraftSchema = z
  .object({
    ordinal: z.number().int().min(1),
    title: z.string(),
    summary: z.string().nullable(),
  })
  .strict()

export const ProgressPartialScoreSchema = z
  .object({
    candidateKey: z.string(),
    scores: z.partialRecord(
      RubricCriterionKeySchema,
      z.number().int().min(0).max(2),
    ),
  })
  .strict()

export const ProgressItemSchema = z
  .object({
    ref: z.string(),
    kind: z.enum(['FACT', 'CONSTRAINT']),
    text: z.string(),
    evidenceText: z.string(),
    evidenceStart: z.number().int(),
    evidenceEnd: z.number().int(),
    strength: z.enum(['hard', 'soft']).nullable(),
  })
  .strict()

export const ProgressCandidateSchema = z
  .object({
    key: z.string(),
    ordinal: z.number().int(),
    title: z.string(),
    distance: z.enum(['near', 'adjacent', 'leap']).nullable(),
    fitRationale: z.string(),
    strongestObjection: z.string(),
    firstTest: z.string(),
    quality: CandidateQualitySchema.nullable(),
    qualityScore: z.number().nullable(),
    constraintEvaluations: z.array(ConstraintEvaluationDtoSchema),
    eligibility: z.enum(['ELIGIBLE', 'REJECTED']).nullable(),
    rejectionReasons: z.array(z.string()),
    selectionState: z
      .enum(['SELECTED', 'NOT_SELECTED', 'REJECTED', 'DUPLICATE'])
      .nullable(),
    selectionScore: z.number().nullable(),
    displayPosition: z.number().int().nullable(),
  })
  .strict()

export const RunProgressSchema = z
  .object({
    stage: RunProgressStageSchema,
    facts: z.array(ProgressItemSchema),
    constraints: z.array(ProgressItemSchema),
    candidates: z.array(ProgressCandidateSchema),
    drafts: z.array(ProgressDraftSchema).optional(),
    partialScores: z.array(ProgressPartialScoreSchema).optional(),
  })
  .strict()

export const CandidateDtoSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    ordinal: z.number().int(),
    operator: UnaryOperatorSchema.nullable(),
    operatorRegistryVersion: z.string().nullable(),
    suitabilityScore: z.number().nullable(),
    selectionScore: z.number().nullable(),
    planningMetadata: z.record(z.string(), z.unknown()).nullable(),
    duplicateOfNodeId: z.string().uuid().nullable(),
    content: IdeaContentSchema,
    constraintEvaluations: z.array(ConstraintEvaluationDtoSchema),
    quality: CandidateQualitySchema,
    qualityScore: z.number(),
    generationMeta: z.record(z.string(), z.unknown()).nullable().optional(),
    eligibility: z.enum(['ELIGIBLE', 'REJECTED']),
    rejectionReasons: z.array(z.string()),
    selectionState: z
      .enum(['SELECTED', 'NOT_SELECTED', 'REJECTED', 'DUPLICATE'])
      .nullable(),
    displayPosition: z.number().int().nullable(),
    hypothesis: HypothesisSchema,
  })
  .strict()

export const GenerationRunSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    kind: z.enum(['INITIAL', 'EXPANSION']),
    status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
    modelProvider: z.string(),
    modelName: z.string(),
    promptVersions: z.record(z.string(), z.string()),
    operator: UnaryOperatorSchema.nullable(),
    parentNodeId: z.string().uuid().nullable(),
    operatorRegistryVersion: z.string().nullable(),
    planningFeatures: z.record(z.string(), z.unknown()).nullable(),
    schemaVersion: z.string(),
    selectionPolicyVersion: z.string(),
    generationStrategy: GenerationStrategySchema.nullable().optional(),
    rubricVersion: z.string().nullable().optional(),
    dedupMode: z.enum(['EMBEDDING', 'TEXT_FALLBACK']).nullable(),
    degraded: z.boolean(),
    attempts: z.array(z.unknown()),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    mockScenario: MockScenarioSchema.nullable(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .strict()

export const PromptItemSchema = z
  .object({
    id: z.string().uuid(),
    ref: z.string(),
    kind: z.enum(['FACT', 'CONSTRAINT']),
    text: z.string(),
    evidenceText: z.string(),
    evidenceStart: z.number().int(),
    evidenceEnd: z.number().int(),
    strength: z.enum(['hard', 'soft']).nullable(),
    basis: z.enum(['explicit', 'inferred']).nullable(),
  })
  .strict()

export const GenerationEventSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    runId: z.string().uuid().nullable(),
    nodeId: z.string().uuid().nullable(),
    type: z.enum([
      'PROJECT_CREATED',
      'INITIAL_GENERATED',
      'GENERATION_FAILED',
      'SLATE_DISPLAYED',
      'NODE_OPENED',
      'NODE_EXPANDED',
      'NODE_PINNED',
      'NODE_UNPINNED',
      'NODE_REJECTED',
      'NODE_ARCHIVED',
      'NODE_EDITED',
      'ACTIVE_NODE_CHANGED',
    ]),
    payload: z.record(z.string(), z.unknown()),
    dedupeKey: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type ModelMode = z.infer<typeof ModelModeSchema>
export type UnaryOperator = z.infer<typeof UnaryOperatorSchema>
export type GenerationStrategy = z.infer<typeof GenerationStrategySchema>
export type NodeStatus = z.infer<typeof NodeStatusSchema>
export type MockScenario = z.infer<typeof MockScenarioSchema>
export type Axes = z.infer<typeof AxesSchema>
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>
export type ExtractedConstraint = z.infer<typeof ExtractedConstraintSchema>
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>
export type Hypothesis = z.infer<typeof HypothesisSchema>
export type FrameCandidate = z.infer<typeof FrameCandidateSchema>
export type FrameOutput = z.infer<typeof FrameOutputSchema>
export type IdeaContent = z.infer<typeof IdeaContentSchema>
export type ExpansionCandidate = z.infer<typeof ExpansionCandidateSchema>
export type ExpandOutput = z.infer<typeof ExpandOutputSchema>
export type EditableIdeaFields = z.infer<typeof EditableIdeaFieldsSchema>
export type CandidateEvaluation = z.infer<typeof CandidateEvaluationSchema>
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>
export type CandidateEvaluationV2 = z.infer<typeof CandidateEvaluationV2Schema>
export type EvaluateOutputV2 = z.infer<typeof EvaluateOutputV2Schema>
export type CandidateQuality = z.infer<typeof CandidateQualitySchema>
export type RunProgressStage = z.infer<typeof RunProgressStageSchema>
export type ProgressItem = z.infer<typeof ProgressItemSchema>
export type ProgressCandidate = z.infer<typeof ProgressCandidateSchema>
export type RunProgress = z.infer<typeof RunProgressSchema>
export type ProgressDraft = z.infer<typeof ProgressDraftSchema>
export type ProgressPartialScore = z.infer<typeof ProgressPartialScoreSchema>
export type RubricCriterionKey = z.infer<typeof RubricCriterionKeySchema>
export type ProjectDto = z.infer<typeof ProjectSchema>
export type GraphNodeDto = z.infer<typeof GraphNodeSchema>
export type GraphEdgeDto = z.infer<typeof GraphEdgeSchema>
export type CandidateDto = z.infer<typeof CandidateDtoSchema>
export type GenerationRunDto = z.infer<typeof GenerationRunSchema>
export type PromptItemDto = z.infer<typeof PromptItemSchema>
export type GenerationEventDto = z.infer<typeof GenerationEventSchema>
export type HealthStatus = z.infer<typeof HealthStatusSchema>
export type DbHealth = z.infer<typeof DbHealthSchema>
