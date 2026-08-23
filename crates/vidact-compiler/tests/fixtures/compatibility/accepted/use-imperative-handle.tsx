import { useImperativeHandle, useState } from 'react'

export function ImperativeCounter({
  ref,
}: {
  ref: (handle: { increment: () => void } | null) => void
}) {
  const [count, setCount] = useState(0)
  useImperativeHandle(ref, () => ({ increment: () => setCount((value) => value + 1) }), [])
  return <output>{count}</output>
}
