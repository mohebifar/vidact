import { createRoot } from '@vidact/runtime/actions'
import { useActionState, useOptimistic, useState } from 'react'

function ActionsCounter(): JSX.Element {
  const [saved, setSaved] = useState('initial')
  const [optimistic, addOptimistic] = useOptimistic(saved)
  const [count, increment, pending] = useActionState(async (previous: number) => previous + 1, 0)
  async function save(data: FormData): Promise<void> {
    const value = String(data.get('value'))
    addOptimistic(value)
    setSaved(value)
  }
  return (
    <form action={save}>
      <input name="value" />
      <button type="submit">save</button>
      <button type="button" onClick={() => increment()}>
        {pending ? 'pending' : count}
      </button>
      <span>{optimistic}</span>
    </form>
  )
}

createRoot(document.body).render(ActionsCounter)
