import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

let currentOutput: HTMLOutputElement | null = null
let currentCounterHandle: CounterHandle | null = null
let secondaryCounterHandle: CounterHandle | null = null
const effectTrace: string[] = []

type CounterHandle = {
  count: number
  increment: () => void
  output: HTMLOutputElement | null
  textAtCreation: string | null | undefined
}

export function readCounterValueRef(): HTMLOutputElement | null {
  return currentOutput
}

export function readCounterHandle(): CounterHandle | null {
  return currentCounterHandle
}

export function readSecondaryCounterHandle(): CounterHandle | null {
  return secondaryCounterHandle
}

export function takeEffectTrace(): string[] {
  return effectTrace.splice(0)
}

function captureCounterHandle(handle: CounterHandle | null): void {
  currentCounterHandle = handle
}

function captureSecondaryCounterHandle(handle: CounterHandle | null): void {
  secondaryCounterHandle = handle
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
      count,
      increment: () => setCount((current) => current + 1),
      output: output.current,
      textAtCreation: output.current?.textContent,
    }),
    [count],
  )
  useLayoutEffect(() => {
    effectTrace.push(`layout:${count}:${output.current?.textContent}`)
    return () => {
      effectTrace.push(`layout-cleanup:${count}`)
    }
  }, [count])
  useEffect(() => {
    effectTrace.push(`passive:${count}:${output.current?.textContent}`)
    return () => {
      effectTrace.push(`passive-cleanup:${count}`)
    }
  }, [count])
  return (
    <output ref={output} data-imperative-count>
      {count}
    </output>
  )
}

export function MultiComponentApp(): JSX.Element {
  const [count, setCount] = useState(0)
  const [useSecondaryHandle, setUseSecondaryHandle] = useState(false)
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
        ref={useSecondaryHandle ? captureSecondaryCounterHandle : captureCounterHandle}
      />
      <button data-imperative-increment onClick={() => currentCounterHandle?.increment()}>
        Increment imperative counter
      </button>
      <button data-switch-handle-ref onClick={() => setUseSecondaryHandle(true)}>
        Switch handle ref
      </button>
    </section>
  )
}
