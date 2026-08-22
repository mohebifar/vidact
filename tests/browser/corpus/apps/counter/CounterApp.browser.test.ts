import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { CounterApp } from './CounterApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled CounterApp', () => {
  it('updates only its scalar, attribute, and conditional binding targets', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(CounterApp, host).dispose

    const root = host.querySelector<HTMLElement>('.counter-app')!
    const decrement = host.querySelector<HTMLButtonElement>('[data-action="decrement"]')!
    const increment = host.querySelector<HTMLButtonElement>('[data-action="increment"]')!
    const count = host.querySelector<HTMLElement>('.count')!
    const doubled = host.querySelector<HTMLElement>('.doubled')!
    const countText = requireSingleDirectText(count)
    const doubledText = requireSingleDirectText(doubled)

    const noOp = await captureMutations(host, () => decrement.click())
    expect(noOp.records).toEqual([])

    const incremented = await captureMutations(host, () => increment.click())

    expect(host.querySelector('.counter-app')).toBe(root)
    expect(host.querySelector('[data-action="decrement"]')).toBe(decrement)
    expect(host.querySelector('[data-action="increment"]')).toBe(increment)
    expect(count.textContent).toBe('1')
    expect(doubled.textContent).toBe('2')
    expect(root.dataset.count).toBe('1')
    expect(host.querySelector('.positive')?.textContent).toBe('Positive')
    expect(incremented.records).toHaveLength(5)
    expect(() =>
      assertMutationEnvelope(
        incremented.records,
        [
          { type: 'attributes', target: root, attributeName: 'data-count' },
          { type: 'characterData', target: countText },
          { type: 'attributes', target: doubled, attributeName: 'data-doubled' },
          { type: 'characterData', target: doubledText },
          { type: 'childList', target: root },
        ],
        'CounterApp increment',
      ),
    ).not.toThrow()

    const decremented = await captureMutations(host, () => decrement.click())

    expect(host.querySelector('.counter-app')).toBe(root)
    expect(count.textContent).toBe('0')
    expect(doubled.textContent).toBe('0')
    expect(host.querySelector('.positive')).toBeNull()
    expect(decremented.records).toHaveLength(5)
    expect(() =>
      assertMutationEnvelope(
        decremented.records,
        [
          { type: 'attributes', target: root, attributeName: 'data-count' },
          { type: 'characterData', target: countText },
          { type: 'attributes', target: doubled, attributeName: 'data-doubled' },
          { type: 'characterData', target: doubledText },
          { type: 'childList', target: root },
        ],
        'CounterApp decrement',
      ),
    ).not.toThrow()
  })
})
