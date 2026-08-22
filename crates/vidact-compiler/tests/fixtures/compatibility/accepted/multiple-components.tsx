import { useState } from 'react'

export function Child({ value }: { value: number }) {
  return <output data-child="yes">{value}</output>
}

export function Parent() {
  const [count, setCount] = useState(0)
  return (
    <button onClick={() => setCount((current) => current + 1)}>
      <Child value={count} />
    </button>
  )
}
