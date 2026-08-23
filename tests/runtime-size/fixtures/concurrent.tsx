import { createRoot } from '@vidact/runtime/concurrent'
import { useDeferredValue, useState, useTransition } from 'react'

function ConcurrentCounter(): JSX.Element {
  const [count, setCount] = useState(0)
  const [isPending, startTransition] = useTransition()
  const deferred = useDeferredValue(count)
  return (
    <button onClick={() => startTransition(() => setCount((value) => value + 1))}>
      {isPending ? 'pending' : deferred}
    </button>
  )
}

createRoot(document.body).render(ConcurrentCounter)
