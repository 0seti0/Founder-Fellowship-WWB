import { TRPCClientError } from '@trpc/client'
import { describe, expect, it } from 'vitest'
import { formatErrorMessage } from '../lib/errorMessage'

const serverUnreachableMessage =
  "Can't reach the Unfold server. Check that it's running, then try again."

describe('formatErrorMessage', () => {
  it('explains unreachable-server errors and preserves other messages', () => {
    const unreachableErrors = [
      new Error(
        "Failed to execute 'json' on 'Response': Unexpected end of JSON input",
      ),
      new Error('Failed to fetch'),
      new Error('NetworkError when attempting to fetch resource'),
      new Error('Response is not valid JSON'),
      new TRPCClientError('Request failed without error data'),
    ]

    for (const error of unreachableErrors) {
      expect(formatErrorMessage(error)).toBe(serverUnreachableMessage)
    }
    expect(formatErrorMessage(new Error('Project not found.'))).toBe(
      'Project not found.',
    )
  })
})
