import { useDeferredValue, useState, useTransition } from 'react'

export function ConcurrentApp(): JSX.Element {
  const [query, setQuery] = useState('initial')
  const [isPending, startTransition] = useTransition()
  const deferredQuery = useDeferredValue(query)

  return (
    <section>
      <button data-transition onClick={() => startTransition(() => setQuery('deferred'))}>
        transition
      </button>
      <button data-urgent onClick={() => setQuery('urgent')}>
        urgent
      </button>
      <output data-pending>{isPending ? 'pending' : 'ready'}</output>
      <output data-query>{query}</output>
      <output data-deferred>{deferredQuery}</output>
    </section>
  )
}
