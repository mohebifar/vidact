import { useState, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let snapshotReads = 0
let storeValue = 0
let tearOnSubscribe = true

function subscribe(listener: () => void): () => void {
  if (tearOnSubscribe) {
    tearOnSubscribe = false
    storeValue = 1
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): number {
  snapshotReads += 1
  return storeValue
}

export function publishStore(value: number): void {
  storeValue = value
  for (const listener of listeners) listener()
}

export function readStoreStats(): { readonly reads: number; readonly subscribers: number } {
  return { reads: snapshotReads, subscribers: listeners.size }
}

export function resetStore(): void {
  if (listeners.size !== 0) throw new Error('cannot reset an externally subscribed store')
  snapshotReads = 0
  storeValue = 0
  tearOnSubscribe = true
}

export default function ExternalStoreApp(): JSX.Element {
  const [unrelated, setUnrelated] = useState(0)
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => -1)

  return (
    <section>
      <output data-store={snapshot}>{snapshot}</output>
      <output data-unrelated={unrelated}>{unrelated}</output>
      <button data-publish onClick={() => publishStore(snapshot + 1)}>
        Publish
      </button>
      <button data-update-unrelated onClick={() => setUnrelated(unrelated + 1)}>
        Unrelated
      </button>
    </section>
  )
}
