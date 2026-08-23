import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

function Status(): JSX.Element {
  const status = useFormStatus()
  return <span data-status>{status.pending ? 'pending' : 'idle'}</span>
}

export function ActionsHydrationApp(): JSX.Element {
  const [value, submit, pending] = useActionState(
    async (_previous: string, data: FormData) => String(data.get('value')),
    'initial',
    '/save',
  )
  return (
    <form action={submit}>
      <input name="value" defaultValue="initial" />
      <button type="submit">save</button>
      <span data-pending>{pending ? 'pending' : 'idle'}</span>
      <span data-value>{value}</span>
      <Status />
    </form>
  )
}
