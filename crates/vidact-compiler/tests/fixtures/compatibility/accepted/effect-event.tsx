import { useEffect, useEffectEvent, useState } from 'react'

function subscribe(listener: (label: string) => void): () => void {
  listener('mounted')
  return () => undefined
}

export function EffectEvent() {
  const [count, setCount] = useState(0)
  const onTick = useEffectEvent((label: string) => console.log(label, count))
  useEffect(() => subscribe(onTick), [])
  return <output onClick={() => setCount(count + 1)}>{count}</output>
}
