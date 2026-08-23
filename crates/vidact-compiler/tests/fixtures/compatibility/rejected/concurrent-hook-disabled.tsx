import { useTransition } from 'react'

export function DisabledTransition(): Node {
  const [isPending, startTransition] = useTransition()
  return <button onClick={() => startTransition(() => {})}>{isPending ? 'pending' : 'ready'}</button>
}
