import { useLayoutEffect, useMemo, useState } from 'react'

const trace: string[] = []

export function readCustomHookTrace(): readonly string[] {
  return [...trace]
}

export function resetCustomHookTrace(): void {
  trace.length = 0
}

function useTrackedCounter(initial: number, label: string) {
  const [count, setCount] = useState(initial)
  const doubled = useMemo(() => count * 2, [count])

  useLayoutEffect(() => {
    trace.push(`run:${label}:${count}`)
    return () => {
      trace.push(`cleanup:${label}:${count}`)
    }
  }, [label, count])

  return {
    count,
    doubled,
    increment: () => setCount(count + 1),
  }
}

function CounterPanel({ label }: { readonly label: string }): JSX.Element {
  const { count, doubled, increment } = useTrackedCounter(0, label)
  return (
    <section data-panel={label}>
      <output data-count={count}>{count}</output>
      <output data-doubled={doubled}>{doubled}</output>
      <button data-increment onClick={increment}>
        Increment
      </button>
    </section>
  )
}

export default function CustomHooksApp(): JSX.Element {
  const [visible, setVisible] = useState(true)
  const [label, setLabel] = useState('first')

  return (
    <main>
      <button data-toggle onClick={() => setVisible(!visible)}>
        Toggle
      </button>
      <button data-label onClick={() => setLabel(label === 'first' ? 'second' : 'first')}>
        Label
      </button>
      {visible && <CounterPanel label={label} />}
    </main>
  )
}
