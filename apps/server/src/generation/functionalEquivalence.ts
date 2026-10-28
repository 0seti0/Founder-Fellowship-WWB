import {
  FunctionalEquivalenceOutputSchema,
  type ExtractedConstraint,
  type FrameCandidate,
} from '@unfold/shared'
import { ProviderError, type ModelProvider } from '../model/provider'
import { PipelineError, type PipelineAttempt } from './pipeline'
import { currentDateContext, type CurrentDateContext } from './currentDate'
import {
  FUNCTIONAL_EQUIVALENCE_PROMPT_VERSION,
  FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT,
} from './prompts'

export async function compareCandidates(
  provider: ModelProvider,
  input: {
    originalPrompt: string
    left: FrameCandidate
    right: FrameCandidate
    constraints: ExtractedConstraint[]
    timeoutMs?: number
    currentDate?: CurrentDateContext
  },
) {
  const attempts: PipelineAttempt[] = []
  const { timeoutMs = 30_000, originalPrompt, left, right, constraints } = input
  const currentDate = input.currentDate ?? currentDateContext()
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const signal = AbortSignal.timeout(timeoutMs)
    let usage: Record<string, number> | undefined
    let result: unknown
    try {
      result = await provider.generateStructured({
        task: 'compare',
        promptVersion: FUNCTIONAL_EQUIVALENCE_PROMPT_VERSION,
        schemaVersion: FUNCTIONAL_EQUIVALENCE_PROMPT_VERSION,
        system: FUNCTIONAL_EQUIVALENCE_SYSTEM_PROMPT,
        input: {
          currentDate,
          originalPrompt,
          constraints,
          left,
          right,
        },
        signal,
        onUsage: (value) => {
          usage = value
        },
      })
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : signal.aborted
            ? new ProviderError('Model request timed out', 'TIMEOUT')
            : new ProviderError(
                error instanceof Error
                  ? error.message
                  : 'Model provider failed',
                'PROVIDER_ERROR',
              )
      attempts.push({
        task: 'compare',
        attempt,
        ok: false,
        code: providerError.code,
        message: providerError.message,
        ...(usage ? { metadata: { usage } } : {}),
      })
      throw new PipelineError(
        providerError.message,
        providerError.code,
        attempts,
      )
    }

    const parsed = FunctionalEquivalenceOutputSchema.safeParse(result)
    if (!parsed.success) {
      attempts.push({
        task: 'compare',
        attempt,
        ok: false,
        code: 'MALFORMED_OUTPUT',
        message: parsed.error.message,
        ...(usage ? { metadata: { usage } } : {}),
      })
      if (attempt === 2) {
        throw new PipelineError(
          'Functional-equivalence output did not match the required schema',
          'MALFORMED_OUTPUT',
          attempts,
        )
      }
      continue
    }

    attempts.push({
      task: 'compare',
      attempt,
      ok: true,
      ...(usage ? { metadata: { usage } } : {}),
    })
    return { ...parsed.data, attempts }
  }
  throw new PipelineError(
    'Functional-equivalence comparison failed',
    'MALFORMED_OUTPUT',
    attempts,
  )
}
