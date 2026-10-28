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

The web app runs at <http://localhost:5173> and the server at <http://localhost:3001>. Mock mode is
the default. To enable live requests, set `MODEL_MODE=live`, choose `LLM_PROVIDER` (`openai` by
default or `anthropic`), and set the server-only `LLM_API_KEY` in `.env`. OpenAI defaults to
`https://api.openai.com/v1`, `gpt-4.1` for framing/expansion/evaluation, `gpt-4.1-mini` for
extraction/comparison, and `text-embedding-3-small` for embeddings. Anthropic defaults to
`https://api.anthropic.com/v1`, `claude-sonnet-4-5` for framing/expansion/evaluation, and
`claude-haiku-4-5` for extraction/comparison; `LLM_MAX_TOKENS` defaults to `4096`. `LLM_BASE_URL`,
`LLM_MODEL_STRONG`, `LLM_MODEL_FAST`, `LLM_EMBEDDING_MODEL` (OpenAI only), `LLM_MAX_TOKENS`, and
optional `LLM_TEMPERATURE` can be configured there. Anthropic does not provide embeddings, so its
runs deduplicate in degraded word-overlap mode using normalized token-set Jaccard similarity at
`≥ 0.8`, recorded as `TEXT_FALLBACK`. The deprecated `MODEL_API_KEY` variable remains a fallback
and emits a one-line warning; it is never logged or sent in request bodies. Live-provider failures
are returned to the caller and never fall back to mock output.

## Prompt-to-graph

Enter a prompt in the composer to create a project with a root prompt node and up to four selected
idea directions. The graph is backed by validated model-shaped output and transactional graph
patches. Selecting a direction opens an inspector with its summary, preserved intent, changed
assumptions, rationale, objection, first test, mechanism, facets, hypothesis, and constraint
uncertainty. The selected project and node are reflected in the URL and restored after reload.

Mock mode is the default. Its scenario picker supports `default`, `malformed`, `malformed-once`,
`invalid-evidence`, `invalid-evidence-once`, `paraphrase`, `hard-violation`, `duplicates`,
`low-quality`, `few-pass`, `none-pass`, `weak-diverse`, `provider-error`, `timeout`, and
`embedding-failure`.

Run the development-only generation experiment harness with
`pnpm --filter @unfold/server experiment --`. It defaults to all six strategies and 20 synthetic
fixtures in mock mode; outputs go to the gitignored `apps/server/experiments/out/` directory.
Mock results exercise the pipeline and do not establish candidate quality. See
`apps/server/experiments/README.md`.

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
