import { useSyncExternalStore } from 'react'

let value = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function ExternalStore() {
  const snapshot = useSyncExternalStore(subscribe, () => value, () => -1)
  return <output>{snapshot}</output>
}
