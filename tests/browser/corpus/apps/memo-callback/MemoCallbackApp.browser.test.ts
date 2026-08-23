import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import MemoCallbackApp, { readMemoObservations, resetMemoObservations } from './MemoCallbackApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetMemoObservations()
  document.body.replaceChildren()
})

describe('compiled memo and callback hooks', () => {
  it('preserves identity until dependencies change and updates only subscribed DOM', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(MemoCallbackApp, host).dispose

    const count = host.querySelector<HTMLOutputElement>('[data-count]')!
    const unrelated = host.querySelector<HTMLOutputElement>('[data-unrelated]')!
    const countText = requireSingleDirectText(count)
    const unrelatedText = requireSingleDirectText(unrelated)
    const increment = host.querySelector<HTMLButtonElement>('[data-increment]')!
    const incrementUnrelated = host.querySelector<HTMLButtonElement>('[data-unrelated-increment]')!
    const initial = readMemoObservations()

    expect(initial.values).toHaveLength(1)
    expect(initial.callbacks).toHaveLength(1)

    const unrelatedUpdate = await captureMutations(host, () => incrementUnrelated.click())
    const afterUnrelated = readMemoObservations()

    expect(count.textContent).toBe('0')
    expect(unrelated.textContent).toBe('1')
    expect(afterUnrelated.values).toHaveLength(1)
    expect(afterUnrelated.callbacks).toHaveLength(1)
    expect(afterUnrelated.values[0]).toBe(initial.values[0])
    expect(afterUnrelated.callbacks[0]).toBe(initial.callbacks[0])
    expect(() =>
      assertMutationEnvelope(
        unrelatedUpdate.records,
        [
          { type: 'attributes', target: unrelated, attributeName: 'data-unrelated' },
          { type: 'characterData', target: unrelatedText },
        ],
        'memo unrelated update',
      ),
    ).not.toThrow()

    const dependencyUpdate = await captureMutations(host, () => increment.click())
    const afterDependency = readMemoObservations()

    expect(count.textContent).toBe('1')
    expect(afterDependency.values).toHaveLength(2)
    expect(afterDependency.callbacks).toHaveLength(2)
    expect(afterDependency.values[1]).not.toBe(initial.values[0])
    expect(afterDependency.callbacks[1]).not.toBe(initial.callbacks[0])
    expect(() =>
      assertMutationEnvelope(
        dependencyUpdate.records,
        [
          { type: 'attributes', target: count, attributeName: 'data-count' },
          { type: 'characterData', target: countText },
        ],
        'memo dependency update',
      ),
    ).not.toThrow()
  })
})
