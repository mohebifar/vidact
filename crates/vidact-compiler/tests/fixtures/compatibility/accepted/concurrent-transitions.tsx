import { useDeferredValue, useState, useTransition } from 'react'

export function ConcurrentSearch(): Node {
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()
  const deferredQuery = useDeferredValue(query)
  return (
    <button onClick={() => startTransition(() => setQuery('next'))}>
      {isPending ? 'pending' : deferredQuery}
    </button>
  )
}
