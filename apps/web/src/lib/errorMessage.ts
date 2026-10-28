import { TRPCClientError } from '@trpc/client'

const SERVER_UNREACHABLE_MESSAGE =
  "Can't reach the Unfold server. Check that it's running, then try again."
const UNREACHABLE_ERROR_PATTERN =
  /Unexpected end of JSON input|Failed to fetch|NetworkError|is not valid JSON/i

export function formatErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong.'
  if (
    UNREACHABLE_ERROR_PATTERN.test(error.message) ||
    (error instanceof TRPCClientError && error.data == null)
  ) {
    return SERVER_UNREACHABLE_MESSAGE
  }
  return error.message
}
