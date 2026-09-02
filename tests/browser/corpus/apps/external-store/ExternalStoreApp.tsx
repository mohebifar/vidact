import { useState, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
let snapshotReads = 0
let storeValue = 0
let tearOnSubscribe = true

type TestStore = {
  getSnapshot(): number
  publish(value: number): void
  reset(value: number): void
  subscribe(listener: () => void): () => void
  subscriberCount(): number
}

function createTestStore(initialValue: number): TestStore {
  const storeListeners = new Set<() => void>()
  let value = initialValue
  return {
    getSnapshot: () => value,
    publish(nextValue) {
      value = nextValue
      for (const listener of storeListeners) listener()
    },
    reset(nextValue) {
      if (storeListeners.size !== 0) throw new Error('cannot reset a subscribed switching store')
      value = nextValue
    },
    subscribe(listener) {
      storeListeners.add(listener)
      return () => storeListeners.delete(listener)
    },
    subscriberCount: () => storeListeners.size,
  }
}

const switchingStores = [createTestStore(10), createTestStore(20)] as const

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

export function publishSwitchingStore(index: 0 | 1, value: number): void {
  switchingStores[index].publish(value)
}

export function readSwitchingStoreSubscribers(): readonly [number, number] {
  return [switchingStores[0].subscriberCount(), switchingStores[1].subscriberCount()]
}

export function resetStore(): void {
  if (listeners.size !== 0) throw new Error('cannot reset an externally subscribed store')
  snapshotReads = 0
  storeValue = 0
  tearOnSubscribe = true
  switchingStores[0].reset(10)
  switchingStores[1].reset(20)
}

export default function ExternalStoreApp(): JSX.Element {
  const [unrelated, setUnrelated] = useState(0)
  const [storeIndex, setStoreIndex] = useState<0 | 1>(0)
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => -1)
  const switchingStore = switchingStores[storeIndex]
  const switchingSnapshot = useSyncExternalStore(
    switchingStore.subscribe,
    switchingStore.getSnapshot,
    switchingStore.getSnapshot,
  )

  return (
    <section>
      <output data-store={snapshot}>{snapshot}</output>
      <output data-unrelated={unrelated}>{unrelated}</output>
      <output data-switching-store={switchingSnapshot}>{switchingSnapshot}</output>
      <button data-publish onClick={() => publishStore(snapshot + 1)}>
        Publish
      </button>
      <button data-update-unrelated onClick={() => setUnrelated(unrelated + 1)}>
        Unrelated
      </button>
      <button data-switch-store onClick={() => setStoreIndex(storeIndex === 0 ? 1 : 0)}>
        Switch store
      </button>
    </section>
  )
}
