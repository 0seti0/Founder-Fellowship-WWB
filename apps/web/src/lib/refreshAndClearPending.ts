export async function refreshAndClearPending(
  refresh: () => Promise<unknown>,
  setPending: (pending: boolean) => void,
) {
  try {
    await refresh()
  } catch {
    return
  } finally {
    setPending(false)
  }
}
