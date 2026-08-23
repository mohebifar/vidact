import { useActionState, useOptimistic } from 'react'
import { useFormStatus } from 'react-dom'

function Status() {
  const status = useFormStatus()
  return <span>{status.pending ? 'saving' : 'ready'}</span>
}

export function Actions() {
  const [value, submit, pending] = useActionState(
    async (previous: string, data: FormData) => previous + String(data.get('value')),
    '',
  )
  const [optimistic, addOptimistic] = useOptimistic(value)
  return (
    <form action={submit}>
      <input name="value" />
      <button onClick={() => addOptimistic('saving')}>{pending ? optimistic : value}</button>
      <Status />
    </form>
  )
}
