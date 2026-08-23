import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

type MemoValue = { readonly count: number }
type Increment = () => void

const observedMemoValues: MemoValue[] = []
const observedCallbacks: Increment[] = []

export function readMemoObservations(): {
  readonly callbacks: readonly Increment[]
  readonly values: readonly MemoValue[]
} {
  return { callbacks: observedCallbacks, values: observedMemoValues }
}

export function resetMemoObservations(): void {
  observedMemoValues.length = 0
  observedCallbacks.length = 0
}

export default function MemoCallbackApp(): JSX.Element {
  const [count, setCount] = useState(0)
  const [unrelated, setUnrelated] = useState(0)
  const memoValue = useMemo(() => ({ count }), [count])
  const increment = useCallback(() => setCount(count + 1), [count])

  useLayoutEffect(() => {
    observedMemoValues.push(memoValue)
    observedCallbacks.push(increment)
  }, [memoValue, increment])

  return (
    <section>
      <output data-count={memoValue.count}>{memoValue.count}</output>
      <output data-unrelated={unrelated}>{unrelated}</output>
      <button data-increment onClick={increment}>
        Increment
      </button>
      <button data-unrelated-increment onClick={() => setUnrelated(unrelated + 1)}>
        Unrelated
      </button>
    </section>
  )
}
