import { useState } from 'react'

const CounterValue = ({ value }: { value: number }): JSX.Element => {
  return <output data-counter-value>{value}</output>
}

export function MultiComponentApp(): JSX.Element {
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
