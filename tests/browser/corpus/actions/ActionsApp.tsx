import { useActionState, useOptimistic, useState } from 'react'
import { useFormStatus } from 'react-dom'

let releaseAction: (() => void) | undefined

export function finishAction(): void {
  releaseAction?.()
  releaseAction = undefined
}

function FormStatus(): JSX.Element {
  const status = useFormStatus()
  return (
    <span data-form-status>
      {status.pending ? `pending:${String(status.data?.get('title'))}` : 'idle:none'}
    </span>
  )
}

export function ActionsApp(): JSX.Element {
  const [saved, setSaved] = useState('initial')
  const [optimistic, addOptimistic] = useOptimistic(saved)
  const [count, increment, pending] = useActionState(async (previous: number) => previous + 1, 0)
  async function submit(data: FormData): Promise<void> {
    const next = String(data.get('title'))
    addOptimistic(next)
    await new Promise<void>((resolve) => {
      releaseAction = resolve
    })
    setSaved(next)
  }

  return (
    <>
      <form id="actions-form" action={submit}>
        <input name="title" defaultValue="initial" />
        <button type="submit">save</button>
        <button data-increment type="button" onClick={() => increment()}>
          increment
        </button>
        <output data-pending>{pending ? 'pending' : 'idle'}</output>
        <output data-count>{count}</output>
        <output data-saved>{saved}</output>
        <output data-optimistic>{optimistic}</output>
        <FormStatus />
      </form>
      <button
        data-forwarded-submit
        type="submit"
        {...{
          form: 'actions-form',
          formAction: async (data: FormData) => setSaved(`forwarded:${String(data.get('title'))}`),
        }}
      >
        forwarded
      </button>
    </>
  )
}
