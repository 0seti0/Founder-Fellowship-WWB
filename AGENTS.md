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
