import { useState } from 'react'

function CounterValue({ value }: { value: number }): Node {
  return <output data-counter-value>{value}</output>
}

export function MultiComponentApp(): Node {
  const [count, setCount] = useState(0)
  return (
    <section data-multi-component-app>
      <CounterValue value={count} />
      <button data-increment onClick={() => setCount((current) => current + 1)}>
        Increment
      </button>
    </section>
  )
}
