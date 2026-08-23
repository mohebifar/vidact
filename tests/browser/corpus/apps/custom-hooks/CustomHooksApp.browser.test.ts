import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import CustomHooksApp, { readCustomHookTrace, resetCustomHookTrace } from './CustomHooksApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetCustomHookTrace()
  document.body.replaceChildren()
})

describe('compiled custom hooks', () => {
  it('shares the caller owner, updates surgically, and cleans up every lifetime', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(CustomHooksApp, host).dispose

    let panel = host.querySelector<HTMLElement>('[data-panel]')!
    let count = panel.querySelector<HTMLOutputElement>('[data-count]')!
    let doubled = panel.querySelector<HTMLOutputElement>('[data-doubled]')!
    const countText = requireSingleDirectText(count)
    const doubledText = requireSingleDirectText(doubled)

    expect(readCustomHookTrace()).toEqual(['run:first:0'])

    const countUpdate = await captureMutations(host, () =>
      panel.querySelector<HTMLButtonElement>('[data-increment]')!.click(),
    )

    expect(count.textContent).toBe('1')
    expect(doubled.textContent).toBe('2')
    expect(readCustomHookTrace()).toEqual(['run:first:0', 'cleanup:first:0', 'run:first:1'])
    expect(() =>
      assertMutationEnvelope(
        countUpdate.records,
        [
          { type: 'attributes', target: count, attributeName: 'data-count' },
          { type: 'characterData', target: countText },
          { type: 'attributes', target: doubled, attributeName: 'data-doubled' },
          { type: 'characterData', target: doubledText },
        ],
        'custom hook state update',
      ),
    ).not.toThrow()

    host.querySelector<HTMLButtonElement>('[data-label]')!.click()
    expect(panel.dataset.panel).toBe('second')
    expect(readCustomHookTrace()).toEqual([
      'run:first:0',
      'cleanup:first:0',
      'run:first:1',
      'cleanup:first:1',
      'run:second:1',
    ])

    host.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    expect(host.querySelector('[data-panel]')).toBeNull()
    expect(readCustomHookTrace().at(-1)).toBe('cleanup:second:1')

    host.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    panel = host.querySelector<HTMLElement>('[data-panel]')!
    count = panel.querySelector<HTMLOutputElement>('[data-count]')!
    doubled = panel.querySelector<HTMLOutputElement>('[data-doubled]')!
    expect(count.textContent).toBe('0')
    expect(doubled.textContent).toBe('0')
    expect(readCustomHookTrace().at(-1)).toBe('run:second:0')

    dispose()
    dispose = undefined
    expect(readCustomHookTrace().at(-1)).toBe('cleanup:second:0')
  })
})
