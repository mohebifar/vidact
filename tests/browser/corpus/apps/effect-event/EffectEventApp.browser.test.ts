import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import EffectEventApp, {
  emitStaleTick,
  readEffectEventState,
  resetEffectEventState,
} from './EffectEventApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetEffectEventState()
  document.body.replaceChildren()
})

describe('compiled effect events', () => {
  it('keeps one subscription while the callback reads current state', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(EffectEventApp, host).dispose

    const count = host.querySelector<HTMLOutputElement>('[data-count]')!
    const countText = requireSingleDirectText(count)
    expect(readEffectEventState().subscribers).toBe(1)

    const incremented = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-increment]')!.click(),
    )

    expect(count.textContent).toBe('1')
    expect(readEffectEventState().subscribers).toBe(1)
    expect(() =>
      assertMutationEnvelope(
        incremented.records,
        [
          { type: 'attributes', target: count, attributeName: 'data-count' },
          { type: 'characterData', target: countText },
        ],
        'effect event state update',
      ),
    ).not.toThrow()

    host.querySelector<HTMLButtonElement>('[data-emit]')!.click()
    expect(readEffectEventState().trace).toEqual(['tick:1'])

    dispose()
    dispose = undefined
    expect(readEffectEventState().subscribers).toBe(0)
    expect(() => emitStaleTick('stale')).toThrow('cannot call an effect event after disposal')
  })
})
