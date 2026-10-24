import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '@unfold/server/router'

export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/trpc' })],
})
