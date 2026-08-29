export type OwnedStore<T> = {
  getSnapshot(): T
  publish(next: T): void
  subscribe(listener: () => void): () => void
}

export function createOwnedStore<T>(initialSnapshot: T): OwnedStore<T> {
  let snapshot = initialSnapshot
  const listeners = new Set<() => void>()

  return {
    getSnapshot() {
      return snapshot
    },
    publish(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of Array.from(listeners)) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
