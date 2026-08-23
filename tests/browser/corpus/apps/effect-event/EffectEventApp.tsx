import { useEffectEvent, useLayoutEffect, useState } from 'react'

type TickListener = (label: string) => void

const listeners = new Set<TickListener>()
const trace: string[] = []
let lastListener: TickListener | undefined

function subscribe(listener: TickListener): () => void {
  listeners.add(listener)
  lastListener = listener
  return () => listeners.delete(listener)
}

export function emitTick(label: string): void {
  for (const listener of listeners) listener(label)
}

export function emitStaleTick(label: string): void {
  lastListener?.(label)
}

export function readEffectEventState(): {
  readonly subscribers: number
  readonly trace: readonly string[]
} {
  return { subscribers: listeners.size, trace }
}

export function resetEffectEventState(): void {
  listeners.clear()
  trace.length = 0
  lastListener = undefined
}

export default function EffectEventApp(): JSX.Element {
  const [count, setCount] = useState(0)
  const onTick = useEffectEvent((label: string) => trace.push(`${label}:${count}`))

  useLayoutEffect(() => subscribe(onTick), [])

  return (
    <section>
      <output data-count={count}>{count}</output>
      <button data-increment onClick={() => setCount(count + 1)}>
        Increment
      </button>
      <button data-emit onClick={() => emitTick('tick')}>
        Emit
      </button>
    </section>
  )
}
