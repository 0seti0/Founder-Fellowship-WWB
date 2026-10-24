import { describe, expect, it, vi } from 'vitest'
import { refreshAndClearPending } from '../lib/refreshAndClearPending'

describe('refreshAndClearPending', () => {
  it('releases pending controls without replacing mutation feedback on failure', async () => {
    let pending = true
    const feedback = { notice: 'Changes saved.', error: null as string | null }
    const refresh = vi.fn().mockRejectedValue(new Error('query refresh failed'))

    await refreshAndClearPending(refresh, (value) => {
      pending = value
    })

    expect(refresh).toHaveBeenCalledOnce()
    expect(pending).toBe(false)
    expect(feedback).toEqual({ notice: 'Changes saved.', error: null })
  })
})
