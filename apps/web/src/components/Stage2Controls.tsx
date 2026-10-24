import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  IdeaContentSchema,
  type GraphNodeDto,
  type MockScenario,
} from '@unfold/shared'
import { useEffect, useMemo, useState } from 'react'
import { trpcClient } from '../lib/trpc'

type EditableValues = {
  title: string
  summary: string
  preservedIntent: string
  changedAssumptions: string
  fitRationale: string
  strongestObjection: string
  firstTest: string
  mechanism: string
  facets: string
}

export function Stage2Controls({
  projectId,
  node,
  activeNodeId,
  mobile,
  mockScenario,
  useMockScenario,
  onChanged,
}: {
  projectId: string
  node: GraphNodeDto
  activeNodeId: string | null
  mobile: boolean
  mockScenario: MockScenario
  useMockScenario: boolean
  onChanged: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [expansionState, setExpansionState] = useState<
    'idle' | 'pending' | 'success' | 'empty' | 'failure'
  >('idle')
  const [assumption, setAssumption] = useState('')
  const [values, setValues] = useState<EditableValues | null>(null)
  const contentResult = useMemo(
    () => IdeaContentSchema.safeParse(node.content),
    [node.content],
  )
  const content = contentResult.success ? contentResult.data : null
  const options = useQuery({
    queryKey: ['operator-options', projectId, node.id],
    queryFn: () =>
      trpcClient.nodes.operatorOptions.query({
        projectId,
        parentNodeId: node.id,
      }),
    enabled: node.type === 'IDEA',
    retry: false,
  })

  useEffect(() => {
    if (!content) {
      setValues(null)
      return
    }
    setValues({
      title: content.title,
      summary: content.summary,
      preservedIntent: content.preservedIntent,
      changedAssumptions: content.changedAssumptions.join('\n'),
      fitRationale: content.fitRationale,
      strongestObjection: content.strongestObjection,
      firstTest: content.firstTest,
      mechanism: content.mechanism,
      facets: content.facets.join(', '),
    })
  }, [node.id, content])

  useEffect(() => {
    const first = options.data?.find((option) => option.operator === 'INVERT')
      ?.assumptions[0]
    setAssumption(first ?? '')
  }, [options.data, node.id])

  if (mobile) return null

  async function perform(
    action: 'pin' | 'unpin' | 'reject' | 'archive' | 'setActive',
  ) {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const input = { projectId, nodeId: node.id }
      if (action === 'pin') await trpcClient.nodes.pin.mutate(input)
      if (action === 'unpin') await trpcClient.nodes.unpin.mutate(input)
      if (action === 'reject') await trpcClient.nodes.reject.mutate(input)
      if (action === 'archive') await trpcClient.nodes.archive.mutate(input)
      if (action === 'setActive') await trpcClient.nodes.setActive.mutate(input)
      setNotice('Saved.')
    } catch (caught) {
      setError(message(caught))
    } finally {
      await refreshMutationQueries(queryClient, projectId, onChanged)
      setPending(false)
    }
  }

  async function expand(operator: string) {
    setPending(true)
    setExpansionState('pending')
    setError(null)
    setNotice(null)
    try {
      const result = await trpcClient.projects.expand.mutate({
        projectId,
        parentNodeId: node.id,
        operator: operator as
          'GROUND' | 'REFRAME' | 'LEAP' | 'INVERT' | 'TRANSPLANT',
        ...(useMockScenario ? { mockScenario } : {}),
        ...(operator === 'INVERT' && assumption ? { assumption } : {}),
      })
      if (result.status === 'FAILED') {
        setExpansionState('failure')
        setError(result.errorCode ?? 'Expansion failed.')
      } else {
        const updated = await trpcClient.projects.get.query({ id: projectId })
        const hasChildren = updated.nodes.some(
          (child) => child.runId === result.runId,
        )
        setExpansionState(hasChildren ? 'success' : 'empty')
      }
    } catch (caught) {
      setExpansionState('failure')
      setError(message(caught))
    } finally {
      await refreshMutationQueries(queryClient, projectId, onChanged)
      setPending(false)
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!values) return
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await trpcClient.nodes.edit.mutate({
        projectId,
        nodeId: node.id,
        fields: {
          title: values.title,
          summary: values.summary,
          preservedIntent: values.preservedIntent,
          changedAssumptions: values.changedAssumptions
            .split('\n')
            .map((value) => value.trim())
            .filter(Boolean),
          fitRationale: values.fitRationale,
          strongestObjection: values.strongestObjection,
          firstTest: values.firstTest,
          mechanism: values.mechanism,
          facets: values.facets
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        },
      })
      setNotice('Changes saved.')
    } catch (caught) {
      setError(message(caught))
    } finally {
      await refreshMutationQueries(queryClient, projectId, onChanged)
      setPending(false)
    }
  }

  const isEditable = node.status === 'VISIBLE' || node.status === 'PINNED'

  return (
    <section className="stage2-controls" aria-label="Steering controls">
      {node.type === 'ROOT_PROMPT' ? (
        <p className="root-transform-note">
          Your prompt is the origin of this graph and cannot be transformed.
        </p>
      ) : (
        <>
          <div className="steering-actions">
            {node.status === 'VISIBLE' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void perform('pin')}
              >
                Pin
              </button>
            )}
            {node.status === 'PINNED' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void perform('unpin')}
              >
                Unpin
              </button>
            )}
            {isEditable && (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void perform('reject')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void perform('archive')}
                >
                  Archive
                </button>
              </>
            )}
            {isEditable && activeNodeId !== node.id && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void perform('setActive')}
              >
                Set active
              </button>
            )}
          </div>
          <div className="operator-options">
            <h3>Transform this direction</h3>
            {options.isPending && <p role="status">Loading operators…</p>}
            {options.isError && (
              <p role="alert">Could not load operator options.</p>
            )}
            {options.data?.map((option) => (
              <div className="operator-option" key={option.operator}>
                {option.operator === 'INVERT' &&
                  option.assumptions.length > 0 && (
                    <label>
                      Assumption to invert
                      <select
                        value={assumption}
                        onChange={(event) => setAssumption(event.target.value)}
                      >
                        {option.assumptions.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                <button
                  type="button"
                  disabled={!option.eligible || pending}
                  aria-describedby={`operator-reason-${option.operator}`}
                  onClick={() => void expand(option.operator)}
                >
                  {option.label}
                  {option.suggested ? ' · Suggested' : ''}
                </button>
                <p id={`operator-reason-${option.operator}`}>
                  {option.eligible
                    ? option.description
                    : (option.reason ?? 'Not eligible')}
                </p>
              </div>
            ))}
            {expansionState === 'pending' && (
              <p role="status">Generating directions…</p>
            )}
            {expansionState === 'success' && (
              <p className="expansion-notice" role="status">
                New directions added.
              </p>
            )}
            {expansionState === 'empty' && (
              <p className="expansion-notice" role="status">
                No candidates met the quality bar; nothing was added.
              </p>
            )}
            {expansionState === 'failure' && (
              <p role="alert">Expansion failed.</p>
            )}
          </div>
          {content && values && isEditable && (
            <form
              className="idea-editor"
              onSubmit={(event) => void saveEdit(event)}
            >
              <h3>Edit direction</h3>
              {(
                [
                  ['title', 'Title'],
                  ['summary', 'Summary'],
                  ['preservedIntent', 'Preserved intent'],
                  ['changedAssumptions', 'Changed assumptions'],
                  ['fitRationale', 'Why it might fit'],
                  ['strongestObjection', 'Strongest objection'],
                  ['firstTest', 'First test'],
                  ['mechanism', 'Mechanism'],
                  ['facets', 'Facets (comma separated)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  {['title'].includes(key) ? (
                    <input
                      value={values[key]}
                      onChange={(event) =>
                        setValues({ ...values, [key]: event.target.value })
                      }
                    />
                  ) : (
                    <textarea
                      rows={key === 'summary' ? 3 : 2}
                      value={values[key]}
                      onChange={(event) =>
                        setValues({ ...values, [key]: event.target.value })
                      }
                    />
                  )}
                </label>
              ))}
              <button type="submit" disabled={pending}>
                Save edits
              </button>
            </form>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}

async function refreshMutationQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  onChanged: () => Promise<void>,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ['operator-options', projectId],
    }),
    queryClient.invalidateQueries({ queryKey: ['projects', 'list'] }),
    onChanged(),
  ])
}

function message(value: unknown) {
  return value instanceof Error ? value.message : 'Something went wrong.'
}
