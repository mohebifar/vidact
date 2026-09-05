type CacheEntry<Value> = {
  readonly revision: string
  readonly value: Value
}

/** Keeps one compiled revision per stable module/configuration slot. */
export class ReplacementCache<Value> {
  readonly #entries = new Map<string, CacheEntry<Value>>()

  get size(): number {
    return this.#entries.size
  }

  get(slot: string, revision: string): Value | undefined {
    const entry = this.#entries.get(slot)
    return entry?.revision === revision ? entry.value : undefined
  }

  set(slot: string, revision: string, value: Value): void {
    this.#entries.set(slot, { revision, value })
  }
}
