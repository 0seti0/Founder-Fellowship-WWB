# Unfold

Unfold is a small foundation for exploring ideas as a typed, persisted graph.

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

The web app runs at <http://localhost:5173> and the server at <http://localhost:3001>.
The current canvas is a static placeholder; no product features or deployment are included.

## Commands

| Command                                | Purpose                             |
| -------------------------------------- | ----------------------------------- |
| `pnpm dev`                             | Run the web app and server          |
| `pnpm build`                           | Build both applications             |
| `pnpm typecheck`                       | Typecheck all workspace packages    |
| `pnpm lint`                            | Run ESLint                          |
| `pnpm format` / `pnpm format:check`    | Format files / check formatting     |
| `pnpm test`                            | Run unit tests                      |
| `pnpm test:integration`                | Run MySQL integration tests         |
| `pnpm test:e2e`                        | Run Playwright smoke test           |
| `pnpm db:up` / `pnpm db:down`          | Start / stop local MySQL            |
| `pnpm db:generate` / `pnpm db:migrate` | Generate / apply Drizzle migrations |

## Layout

- `apps/server`: Hono API, tRPC router, and MySQL/Drizzle plumbing
- `apps/web`: React/Vite shell and static graph placeholder
- `packages/shared`: shared Zod schemas and inferred types
- `docker/mysql`: local database initialization

See [AGENTS.md](./AGENTS.md) for setup details and permanent product invariants. This repository
does not include deployment configuration.
