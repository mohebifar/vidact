import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import ExternalStoreApp, { publishStore, readStoreStats, resetStore } from './ExternalStoreApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetStore()
  document.body.replaceChildren()
})

describe('compiled external stores', () => {
  it('rechecks after subscribing, publishes snapshots surgically, and unsubscribes', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(ExternalStoreApp, host).dispose

    const store = host.querySelector<HTMLOutputElement>('[data-store]')!
    const unrelated = host.querySelector<HTMLOutputElement>('[data-unrelated]')!
    const storeText = requireSingleDirectText(store)
    const readsAfterMount = readStoreStats().reads

    expect(store.textContent).toBe('1')
    expect(readStoreStats().subscribers).toBe(1)
    expect(readsAfterMount).toBe(2)

    const published = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-publish]')!.click(),
    )

    expect(store.textContent).toBe('2')
    expect(() =>
      assertMutationEnvelope(
        published.records,
        [
          { type: 'attributes', target: store, attributeName: 'data-store' },
          { type: 'characterData', target: storeText },
        ],
        'external store publication',
      ),
    ).not.toThrow()

    const readsBeforeUnrelated = readStoreStats().reads
    host.querySelector<HTMLButtonElement>('[data-update-unrelated]')!.click()
    expect(unrelated.textContent).toBe('1')
    expect(store.textContent).toBe('2')
    expect(readStoreStats().reads).toBe(readsBeforeUnrelated)

    dispose()
    dispose = undefined
    expect(readStoreStats().subscribers).toBe(0)
    expect(() => publishStore(10)).not.toThrow()
  })
})
