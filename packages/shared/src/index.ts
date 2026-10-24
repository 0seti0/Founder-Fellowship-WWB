import { z } from 'zod'

export const ModelModeSchema = z.enum(['mock', 'live'])

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
    axes: AxesSchema,
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
    facets: z.array(z.string().min(1)).min(1).max(6),
    distance: z.enum(['near', 'adjacent', 'leap']),
  })
  .strict()

export const FrameOutputSchema = z
  .object({
    candidates: z.array(FrameCandidateSchema).min(4).max(8),
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

export const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    originalPrompt: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const GraphNodeSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    type: z.enum(['ROOT_PROMPT', 'IDEA']),
    origin: z.enum(['PROMPT', 'INITIAL_FRAME']),
    operator: z.string().nullable(),
    runId: z.string().uuid().nullable(),
    candidateId: z.string().uuid().nullable(),
    title: z.string(),
    summary: z.string(),
    content: z.record(z.string(), z.unknown()),
    displayPosition: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
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

export const CandidateDtoSchema = z
  .object({
    id: z.string().uuid(),
    ordinal: z.number().int(),
    content: FrameCandidateSchema,
    constraintEvaluations: z.array(ConstraintEvaluationDtoSchema),
    quality: z
      .object({
        intentAlignment: EvaluationDimensionSchema,
        usefulness: EvaluationDimensionSchema,
        specificity: EvaluationDimensionSchema,
      })
      .strict(),
    qualityScore: z.number(),
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
    kind: z.literal('INITIAL'),
    status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']),
    modelProvider: z.string(),
    modelName: z.string(),
    promptVersions: z
      .object({
        extract: z.string(),
        frame: z.string(),
        evaluate: z.string(),
      })
      .strict(),
    schemaVersion: z.string(),
    selectionPolicyVersion: z.string(),
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
    ]),
    payload: z.record(z.string(), z.unknown()),
    dedupeKey: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type ModelMode = z.infer<typeof ModelModeSchema>
export type MockScenario = z.infer<typeof MockScenarioSchema>
export type Axes = z.infer<typeof AxesSchema>
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>
export type ExtractedConstraint = z.infer<typeof ExtractedConstraintSchema>
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>
export type Hypothesis = z.infer<typeof HypothesisSchema>
export type FrameCandidate = z.infer<typeof FrameCandidateSchema>
export type FrameOutput = z.infer<typeof FrameOutputSchema>
export type CandidateEvaluation = z.infer<typeof CandidateEvaluationSchema>
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>
export type ProjectDto = z.infer<typeof ProjectSchema>
export type GraphNodeDto = z.infer<typeof GraphNodeSchema>
export type GraphEdgeDto = z.infer<typeof GraphEdgeSchema>
export type CandidateDto = z.infer<typeof CandidateDtoSchema>
export type GenerationRunDto = z.infer<typeof GenerationRunSchema>
export type PromptItemDto = z.infer<typeof PromptItemSchema>
export type GenerationEventDto = z.infer<typeof GenerationEventSchema>
export type HealthStatus = z.infer<typeof HealthStatusSchema>
export type DbHealth = z.infer<typeof DbHealthSchema>
