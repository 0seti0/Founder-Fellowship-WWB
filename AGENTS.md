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

## Staged execution plan

| Stage                               | User-visible outcome                                                                                                                                                                                                                                                                                                          | Acceptance gate                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Initial graph                    | Prompt in → persisted typed DAG rendered as an original-prompt root with up to four actionable direction nodes (normally 2–4) derived from ~6 hypotheses; extracted evidence spans are not separate idea nodes                                                                                                                | Candidates schema-validated; extracted facts/constraints satisfy exact evidence-span containment; goal hypotheses labeled with assumptions and violate no hard constraint; DAG persists and reloads unchanged                                                                                               |
| 2. Transformation operators (unary) | User applies GROUND, REFRAME, LEAP, INVERT, TRANSPLANT via expand/pin/reject/edit steering; expansion overgenerates and displays up to three directions                                                                                                                                                                       | Each operator's preconditions are deterministic; patches apply transactionally; quality floors (deterministic completeness + hard-constraint checks + semantic intent/usefulness/specificity) enforced with unknown-constraint status not treated as violation; full candidate-set + policy-version logging |
| 3. COMBINE & concurrency            | User merges exactly two distinct pinned nodes via COMBINE, creating one child with two parents; concurrent operations stay consistent                                                                                                                                                                                         | COMBINE rejects any input that is not two distinct pinned nodes, produces a valid acyclic DAG child, and concurrent patches serialize without data loss under an integration test                                                                                                                           |
| 4. Evidence profile                 | User sees and edits a per-project profile containing system-generated hypotheses (from repeated meaningful events) and user-authored/edited hypotheses                                                                                                                                                                        | Profile persists within project scope only with no cross-project leakage; it modestly influences ranking/coverage but is shown unable to override schema validation, hard constraints, operator eligibility, or quality floors                                                                              |
| 5. Artifact & evaluation harness    | User generates an editable Markdown Decision & Action Brief (selected direction; objective and beneficiary; hypothetical fit rationale; lineage; facts vs. assumptions; strongest objection; smallest first test; three concrete next steps); a three-mode harness runs direct, graph-without-profile, and graph-with-profile | Brief derives only from the selected node and its ancestry, excluding non-ancestor branches; the strong single-call direct-answer baseline and all three harness modes run reproducibly in mock mode; no mode is declared a winner without human evaluation                                                 |
| 6. Hardening                        | Reliable end-to-end flow with quality floors, near-deduplication, soft facet coverage, and complete audit logs visible                                                                                                                                                                                                        | CI green in mock mode with quality-floor / near-dedup / soft-coverage (no rigid quotas) tests and verified event/model/prompt/policy-version logging                                                                                                                                                        |

## Setup & commands

Prerequisites: Node.js 24 (Node.js 22 or newer is supported), Corepack with pnpm 10, and Docker
with Compose.

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

Integration tests need MySQL running with `pnpm db:up` and migrations applied with
`pnpm db:migrate`. The web smoke test does not require MySQL.

Useful commands: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
`pnpm test:integration`, `pnpm test:e2e`, `pnpm db:generate`, and `pnpm db:migrate`.

## Product invariants (permanent — do not violate)

- The persisted typed idea DAG is the backend source of truth.
- Models propose structured candidates; only deterministic, validated, transactional graph patches may mutate the graph.
- No chat-first workflow, clarifying-question flow, agent framework, vector database, RL, or bandits.
- All model output is schema-validated and generation metadata is logged.
- Operator preconditions are deterministic.
- Artifacts use selected ancestry only.
- Mock mode is the CI default; secrets remain server-side; no public deployment.
