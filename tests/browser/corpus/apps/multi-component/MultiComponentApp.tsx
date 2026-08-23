import { useImperativeHandle, useRef, useState } from 'react'

let currentOutput: HTMLOutputElement | null = null
let currentCounterHandle: CounterHandle | null = null

type CounterHandle = {
  increment: () => void
  output: HTMLOutputElement | null
}

export function readCounterValueRef(): HTMLOutputElement | null {
  return currentOutput
}

export function readCounterHandle(): CounterHandle | null {
  return currentCounterHandle
}

const CounterValue = ({
  value: displayed,
  ref,
}: {
  value: number
  ref: (node: HTMLOutputElement | null) => void
}): JSX.Element => (
  <output ref={ref} data-counter-value>
    {displayed}
  </output>
)

function ImperativeCounter({ ref }: { ref: (handle: CounterHandle | null) => void }): JSX.Element {
  const [count, setCount] = useState(0)
  const output = useRef<HTMLOutputElement | null>(null)
  useImperativeHandle(
    ref,
    () => ({
      increment: () => setCount((current) => current + 1),
      output: output.current,
    }),
    [],
  )
  return (
    <output ref={output} data-imperative-count>
      {count}
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
      <ImperativeCounter
        ref={(handle) => {
          currentCounterHandle = handle
        }}
      />
      <button data-imperative-increment onClick={() => currentCounterHandle?.increment()}>
        Increment imperative counter
      </button>
    </section>
  )
}
