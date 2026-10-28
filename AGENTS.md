## Product kernel (permanent)

### What Unfold is

Unfold is a visual possibility engine. A user enters an underspecified prompt;
the system generates several meaningfully different deeper-goal directions with
no follow-up questions. The user steers, and a selected ancestry becomes an
editable action brief.

### Objective

Optimize for aligned novelty — faithful to the prompt yet meaningfully distinct.
Aligned novelty is a qualitative product objective, not an automatic scalar metric.

### Source of truth

The persisted typed idea DAG is authoritative. Models propose schema-validated
candidates; the backend checks deterministic preconditions and applies selected
proposals through restricted transactional graph patches.

### Extraction & hypotheses

Exact evidence-span containment applies only to explicitly extracted facts and
constraints. Goal hypotheses may go beyond what the prompt entails but must be
labeled as hypotheses with assumptions and must never violate an explicit hard
constraint.

### Direction counts

Initial framing generates ~6 hypotheses and displays up to 4 directions
(normally 2–4). Expansion overgenerates and displays up to 3. Fewer may show
when candidates fail the quality floor.

### Operators & steering

Six transformation operators: GROUND, REFRAME, LEAP, INVERT, TRANSPLANT,
COMBINE. Each has deterministic preconditions. COMBINE requires exactly two
distinct pinned nodes and creates one child with two parents. Pin, reject, edit,
and expand are steering actions, not operators.

### Selection

Quality floors combine deterministic completeness and hard-constraint checks
with structured semantic evaluation of intent alignment, usefulness, and
specificity. Hard filtering is deterministic; unknown constraint status is not a
violation. Selection uses near-deduplication and soft facet coverage without
rigid diversity quotas.

### Logging

Every run logs the full candidate set, events, model identity, prompt, and
policy version.

### Profile

Each project holds a persistent (non-cross-project) profile of system-generated
hypotheses from repeated meaningful events plus user-authored/edited hypotheses.
It modestly influences later ranking and coverage but cannot override schema
validation, hard constraints, operator eligibility, or quality floors.

### Artifacts

An editable Markdown Decision & Action Brief is built from the selected node and
its ancestry only, excluding non-ancestor branches.

### Boundaries

Mock providers are the CI default; secrets stay server-side; no public
deployment. No chat-first workflow, clarifying-question flow, agent framework,
vector database, RL, or bandits.

## Product invariants (permanent — do not violate)

The Product kernel above defines the permanent product rules. These invariants also apply:

- Only deterministic, validated, transactional graph patches may mutate the graph.
- All model output is schema-validated, and generation metadata is logged.

## Setup & commands

Prerequisites: Node.js 24 (Node.js 22 or newer is supported), Corepack with pnpm 10, and Docker
with Compose.

Non-interactive shells must run `source ~/.nvm/nvm.sh` before invoking `node` or `pnpm`.

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

Install Playwright's Chromium browser before running end-to-end tests:

```sh
pnpm --filter @unfold/web exec playwright install --with-deps chromium
```

Integration and end-to-end tests need MySQL running with `pnpm db:up` and migrations applied with
`pnpm db:migrate`.

Useful commands: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
`pnpm test:integration`, `pnpm test:e2e`, `pnpm db:generate`, and `pnpm db:migrate`.

Mock mode is the default and does not require a model credential. For live generation, set
`MODEL_MODE=live` and the server-only `LLM_API_KEY`; an OpenAI-compatible base URL and model names
can be configured with `LLM_BASE_URL`, `LLM_MODEL_STRONG`, `LLM_MODEL_FAST`, and
`LLM_EMBEDDING_MODEL`, with optional `LLM_TEMPERATURE`. `MODEL_API_KEY` is a deprecated fallback
and emits a one-line warning without revealing its value. Provider failures do not silently fall
back to mock output.
