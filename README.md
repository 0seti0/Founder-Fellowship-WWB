# Unfold

Unfold is a visual possibility engine. Stage 1 turns an underspecified prompt into a persisted
idea graph with several meaningfully different directions.

## Prerequisites

- Node.js 24 (Node.js 22 or newer is supported)
- Corepack and pnpm 10
- Docker with Compose

## Setup

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

The web app runs at <http://localhost:5173> and the server at <http://localhost:3001>. The current
generation provider is deterministic mock mode; live model calls are not implemented.

## Prompt-to-graph

Enter a prompt in the composer to create a project with a root prompt node and up to four selected
idea directions. The graph is backed by validated model-shaped output and transactional graph
patches. Selecting a direction opens an inspector with its summary, preserved intent, changed
assumptions, rationale, objection, first test, mechanism, facets, hypothesis, and constraint
uncertainty. The selected project and node are reflected in the URL and restored after reload.

Mock mode is the default. Its scenario picker supports `default`, `malformed`, `malformed-once`,
`invalid-evidence`, `invalid-evidence-once`, `paraphrase`, `hard-violation`, `duplicates`,
`low-quality`, `few-pass`, `none-pass`, `weak-diverse`, `provider-error`, `timeout`, and
`embedding-failure`. The live provider deliberately reports an error rather than silently falling
back to mock mode.

Candidate deduplication uses embedding cosine similarity at `≥ 0.92`. If embeddings fail, the
pipeline falls back to normalized token-set Jaccard similarity at `≥ 0.8`; this is recorded as
`TEXT_FALLBACK`, marks the run degraded, and logs the fallback reason.

## Steering and operator expansion

Select an idea direction to inspect its persisted content and steer the graph. Visible directions
can be pinned, edited, rejected, archived, or made active. Rejected and archived nodes are hidden
by default; use **Reveal rejected and archived** to show them. The graph records operator ancestry
and keeps existing node positions when new children are added.

An eligible idea can be expanded with one of five unary operators: **GROUND**, **REFRAME**,
**LEAP**, **INVERT**, or **TRANSPLANT**. Operator availability and disabled reasons come from the
server's persisted-graph planner. Expansion requests six mock candidates, validates operator
effects and constraints, then displays up to three candidates that pass the quality floor. An
expansion may succeed with no added directions when none meet that floor.

Mock scenarios `operator-mismatch` and `operator-gaps` exercise operator validation and incomplete
initial candidate content. Mock-only scenarios are not accepted when the server is configured for
live mode. The COMBINE operator and profile/artifact workflows are not part of this stage.

## Commands

| Command                                | Purpose                                 |
| -------------------------------------- | --------------------------------------- |
| `pnpm dev`                             | Run the web app and server              |
| `pnpm build`                           | Build both applications                 |
| `pnpm typecheck`                       | Typecheck all workspace packages        |
| `pnpm lint`                            | Run ESLint                              |
| `pnpm format` / `pnpm format:check`    | Format files / check formatting         |
| `pnpm test`                            | Run unit tests                          |
| `pnpm test:integration`                | Run MySQL integration tests             |
| `pnpm test:e2e`                        | Run desktop and mobile Playwright flows |
| `pnpm db:up` / `pnpm db:down`          | Start / stop local MySQL                |
| `pnpm db:generate` / `pnpm db:migrate` | Generate / apply Drizzle migrations     |

## Layout

- `apps/server`: Hono API, tRPC router, and MySQL/Drizzle plumbing
- `apps/web`: React/Vite prompt composer, graph, and direction inspector
- `packages/shared`: shared Zod schemas and inferred types
- `docker/mysql`: local database initialization

See [AGENTS.md](./AGENTS.md) for setup details and permanent product invariants. This repository
does not include deployment configuration.
