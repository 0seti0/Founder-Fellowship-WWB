import type {
  CandidateEvaluation,
  FrameCandidate,
  Hypothesis,
  MockScenario,
} from '@unfold/shared'
import {
  bigint,
  boolean,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

export const appMeta = mysqlTable('app_meta', {
  key: varchar('key', { length: 191 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .onUpdateNow()
    .notNull(),
})

export const projects = mysqlTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  title: varchar('title', { length: 191 }).notNull(),
  originalPrompt: text('original_prompt').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .defaultNow()
    .onUpdateNow()
    .notNull(),
})

export const generationRuns = mysqlTable(
  'generation_runs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', ['INITIAL']).notNull(),
    status: mysqlEnum('status', [
      'PENDING',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
    ]).notNull(),
    modelProvider: varchar('model_provider', { length: 191 }).notNull(),
    modelName: varchar('model_name', { length: 191 }).notNull(),
    promptVersions: json('prompt_versions')
      .$type<{ extract: string; frame: string; evaluate: string }>()
      .notNull(),
    schemaVersion: varchar('schema_version', { length: 64 }).notNull(),
    selectionPolicyVersion: varchar('selection_policy_version', {
      length: 64,
    }).notNull(),
    dedupMode: mysqlEnum('dedup_mode', ['EMBEDDING', 'TEXT_FALLBACK']),
    degraded: boolean('degraded').notNull().default(false),
    attempts: json('attempts').$type<unknown[]>().notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    mockScenario: varchar('mock_scenario', {
      length: 64,
    }).$type<MockScenario>(),
    startedAt: timestamp('started_at', { mode: 'date' }),
    finishedAt: timestamp('finished_at', { mode: 'date' }),
  },
  (table) => [index('generation_runs_project_id_idx').on(table.projectId)],
)

export const nodes = mysqlTable(
  'nodes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', ['ROOT_PROMPT', 'IDEA']).notNull(),
    origin: mysqlEnum('origin', ['PROMPT', 'INITIAL_FRAME']).notNull(),
    operator: varchar('operator', { length: 64 }),
    runId: varchar('run_id', { length: 36 }).references(
      () => generationRuns.id,
      { onDelete: 'cascade' },
    ),
    candidateId: varchar('candidate_id', { length: 36 }).unique(),
    title: varchar('title', { length: 120 }).notNull(),
    summary: varchar('summary', { length: 600 }).notNull(),
    content: json('content').$type<Record<string, unknown>>().notNull(),
    displayPosition: int('display_position'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('nodes_project_id_idx').on(table.projectId)],
)

export const edges = mysqlTable(
  'edges',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: varchar('parent_id', { length: 36 })
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    childId: varchar('child_id', { length: 36 })
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('edges_parent_child_uq').on(table.parentId, table.childId),
    index('edges_project_id_idx').on(table.projectId),
  ],
)

export const promptAnalyses = mysqlTable(
  'prompt_analyses',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [index('prompt_analyses_project_id_idx').on(table.projectId)],
)

export const promptItems = mysqlTable(
  'prompt_items',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    analysisId: varchar('analysis_id', { length: 36 })
      .notNull()
      .references(() => promptAnalyses.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ref: varchar('ref', { length: 32 }).notNull(),
    kind: mysqlEnum('kind', ['FACT', 'CONSTRAINT']).notNull(),
    text: text('text').notNull(),
    evidenceText: text('evidence_text').notNull(),
    evidenceStart: int('evidence_start').notNull(),
    evidenceEnd: int('evidence_end').notNull(),
    strength: mysqlEnum('strength', ['hard', 'soft']),
    basis: mysqlEnum('basis', ['explicit', 'inferred']),
  },
  (table) => [
    uniqueIndex('prompt_items_analysis_ref_uq').on(table.analysisId, table.ref),
    index('prompt_items_project_id_idx').on(table.projectId),
  ],
)

export const candidates = mysqlTable(
  'candidates',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    ordinal: int('ordinal').notNull(),
    modelKey: varchar('model_key', { length: 191 }).notNull(),
    content: json('content').$type<FrameCandidate>().notNull(),
    constraintEvaluations: json('constraint_evaluations')
      .$type<CandidateEvaluation['constraints']>()
      .notNull(),
    quality: json('quality')
      .$type<{
        intentAlignment: CandidateEvaluation['intentAlignment']
        usefulness: CandidateEvaluation['usefulness']
        specificity: CandidateEvaluation['specificity']
      }>()
      .notNull(),
    completeness: json('completeness')
      .$type<Record<string, boolean>>()
      .notNull(),
    genericFirstTest: boolean('generic_first_test').notNull(),
    eligibility: mysqlEnum('eligibility', ['ELIGIBLE', 'REJECTED']).notNull(),
    rejectionReasons: json('rejection_reasons').$type<string[]>().notNull(),
    qualityScore: double('quality_score').notNull(),
    duplicateOfCandidateId: varchar('duplicate_of_candidate_id', {
      length: 36,
    }),
    dedupSimilarity: double('dedup_similarity'),
    selectionState: mysqlEnum('selection_state', [
      'SELECTED',
      'NOT_SELECTED',
      'REJECTED',
      'DUPLICATE',
    ]),
    selectionScore: double('selection_score'),
    displayPosition: int('display_position'),
    selectionProbability: double('selection_probability'),
    selectionMetadata: json('selection_metadata')
      .$type<Record<string, unknown>>()
      .notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    schemaVersion: varchar('schema_version', { length: 64 }).notNull(),
    policyVersion: varchar('policy_version', { length: 64 }).notNull(),
    nodeId: varchar('node_id', { length: 36 }).references(() => nodes.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('candidates_run_ordinal_uq').on(table.runId, table.ordinal),
    uniqueIndex('candidates_run_model_key_uq').on(table.runId, table.modelKey),
    index('candidates_project_id_idx').on(table.projectId),
  ],
)

export const hypotheses = mysqlTable(
  'hypotheses',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 36 })
      .notNull()
      .references(() => generationRuns.id, { onDelete: 'cascade' }),
    candidateId: varchar('candidate_id', { length: 36 })
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    statement: text('statement').notNull(),
    axes: json('axes').$type<Hypothesis['axes']>().notNull(),
    assumptions: json('assumptions').$type<string[]>().notNull(),
    supportingFactIds: json('supporting_fact_ids').$type<string[]>().notNull(),
    counterevidence: json('counterevidence').$type<string[]>().notNull(),
    falsifiers: json('falsifiers').$type<string[]>().notNull(),
  },
  (table) => [
    uniqueIndex('hypotheses_candidate_id_uq').on(table.candidateId),
    index('hypotheses_project_id_idx').on(table.projectId),
  ],
)

export const events = mysqlTable(
  'events',
  {
    seq: bigint('seq', { mode: 'number' }).autoincrement().primaryKey(),
    id: varchar('id', { length: 36 }).notNull().unique(),
    projectId: varchar('project_id', { length: 36 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 36 }).references(
      () => generationRuns.id,
      { onDelete: 'cascade' },
    ),
    nodeId: varchar('node_id', { length: 36 }).references(() => nodes.id, {
      onDelete: 'set null',
    }),
    type: mysqlEnum('type', [
      'PROJECT_CREATED',
      'INITIAL_GENERATED',
      'GENERATION_FAILED',
      'SLATE_DISPLAYED',
      'NODE_OPENED',
    ]).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    dedupeKey: varchar('dedupe_key', { length: 191 }).unique(),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    index('events_project_id_seq_idx').on(table.projectId, table.seq),
    index('events_run_id_idx').on(table.runId),
  ],
)
