import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import ExternalStoreApp, {
  publishStore,
  publishSwitchingStore,
  readStoreStats,
  readSwitchingStoreSubscribers,
  resetStore,
} from './ExternalStoreApp.tsx'

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

  it('resubscribes when reactive store inputs change without remounting', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(ExternalStoreApp, host).dispose

    const output = host.querySelector<HTMLOutputElement>('[data-switching-store]')!
    const outputText = requireSingleDirectText(output)
    const originalOutput = output

    expect(output.textContent).toBe('10')
    expect(readSwitchingStoreSubscribers()).toEqual([1, 0])

    const switched = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-switch-store]')!.click(),
    )

    expect(host.querySelector('[data-switching-store]')).toBe(originalOutput)
    expect(output.textContent).toBe('20')
    expect(readSwitchingStoreSubscribers()).toEqual([0, 1])
    expect(() =>
      assertMutationEnvelope(
        switched.records,
        [
          { type: 'attributes', target: output, attributeName: 'data-switching-store' },
          { type: 'characterData', target: outputText },
        ],
        'external-store resubscription',
      ),
    ).not.toThrow()

    publishSwitchingStore(0, 11)
    expect(output.textContent).toBe('20')
    publishSwitchingStore(1, 21)
    expect(output.textContent).toBe('21')

    dispose()
    dispose = undefined
    expect(readSwitchingStoreSubscribers()).toEqual([0, 0])
  })
})
