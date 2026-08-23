import { Activity, useLayoutEffect, useState, useSyncExternalStore } from 'react'

const effectTrace: string[] = []
const storeListeners = new Set<() => void>()
let storeValue = 0

export function readEffectTrace(): readonly string[] {
  return effectTrace
}

export function readSubscriptionCount(): number {
  return storeListeners.size
}

export function emitStore(value: number): void {
  storeValue = value
  for (const listener of storeListeners) listener()
}

export function resetRetainedUiTrace(): void {
  effectTrace.length = 0
  storeListeners.clear()
  storeValue = 0
}

function subscribe(listener: () => void): () => void {
  storeListeners.add(listener)
  return () => storeListeners.delete(listener)
}

function RetainedPanel(): JSX.Element {
  const [count, setCount] = useState(0)
  const snapshot = useSyncExternalStore(
    subscribe,
    () => storeValue,
    () => storeValue,
  )
  useLayoutEffect(() => {
    effectTrace.push(`connect:${count}:${snapshot}`)
    return () => {
      effectTrace.push(`disconnect:${count}:${snapshot}`)
    }
  }, [count, snapshot])

  return (
    <section data-panel>
      <button data-increment onClick={() => setCount((value) => value + 1)}>
        increment
      </button>
      <output data-count>{count}</output>
      <output data-snapshot>{snapshot}</output>
    </section>
  )
}

export function RetainedUiApp(): JSX.Element {
  const [mode, setMode] = useState<'visible' | 'hidden'>('visible')
  return (
    <main>
      <button
        data-toggle
        onClick={() => setMode((value) => (value === 'visible' ? 'hidden' : 'visible'))}
      >
        toggle
      </button>
      <Activity mode={mode}>
        <RetainedPanel />
      </Activity>
    </main>
  )
}
