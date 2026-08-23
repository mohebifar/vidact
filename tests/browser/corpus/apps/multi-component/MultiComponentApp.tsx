import { useState } from 'react'

let currentOutput: HTMLOutputElement | null = null

export function readCounterValueRef(): HTMLOutputElement | null {
  return currentOutput
}

const CounterValue = ({
  value: displayed,
  ref,
}: {
  value: number
  ref: (node: HTMLOutputElement | null) => void
}): JSX.Element => {
  return (
    <output ref={ref} data-counter-value>
      {displayed}
    </output>
  )
}

export function MultiComponentApp(): JSX.Element {
  const [count, setCount] = useState(0)
  return (
    <section data-multi-component-app>
      <CounterValue
        value={count}
        ref={(node) => {
          currentOutput = node
        }}
      />
      <button data-increment onClick={() => setCount((current) => current + 1)}>
        Increment
      </button>
    </section>
  )
}
