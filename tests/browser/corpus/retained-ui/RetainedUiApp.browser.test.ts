import { mountCompiled } from '@vidact/runtime'
import {
  act,
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import {
  emitStore,
  readEffectTrace,
  readSubscriptionCount,
  resetRetainedUiTrace,
  RetainedUiApp,
} from './RetainedUiApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetRetainedUiTrace()
  document.body.replaceChildren()
})

it('retains hidden DOM and state while reconnecting effects and subscriptions', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(RetainedUiApp, host).dispose

  const toggle = host.querySelector<HTMLButtonElement>('[data-toggle]')!
  const panel = host.querySelector<HTMLElement>('[data-panel]')!
  const increment = panel.querySelector<HTMLButtonElement>('[data-increment]')!
  const count = panel.querySelector<HTMLOutputElement>('[data-count]')!
  const snapshot = panel.querySelector<HTMLOutputElement>('[data-snapshot]')!
  const countText = requireSingleDirectText(count)
  const snapshotText = requireSingleDirectText(snapshot)

  increment.click()
  expect(count.textContent).toBe('1')
  expect(readEffectTrace()).toEqual(['connect:0:0', 'disconnect:0:0', 'connect:1:0'])
  expect(readSubscriptionCount()).toBe(1)

  const hidden = await captureMutations(host, () => toggle.click())
  expect(host.querySelector('[data-panel]')).toBe(panel)
  expect(panel.style.display).toBe('none')
  expect(readSubscriptionCount()).toBe(0)
  expect(readEffectTrace()).toEqual([
    'connect:0:0',
    'disconnect:0:0',
    'connect:1:0',
    'disconnect:1:0',
  ])
  expect(() =>
    assertMutationEnvelope(
      hidden.records,
      [{ type: 'attributes', target: panel, attributeName: 'style' }],
      'hide retained panel',
    ),
  ).not.toThrow()

  emitStore(2)
  increment.click()
  expect(count.textContent).toBe('1')
  expect(snapshot.textContent).toBe('0')
  const hiddenUpdate = await captureMutations(host, () => act(() => {}))
  expect(count.textContent).toBe('2')
  expect(snapshot.textContent).toBe('0')
  expect(panel.style.display).toBe('none')
  expect(readEffectTrace()).toEqual([
    'connect:0:0',
    'disconnect:0:0',
    'connect:1:0',
    'disconnect:1:0',
  ])
  expect(() =>
    assertMutationEnvelope(
      hiddenUpdate.records,
      [{ type: 'characterData', target: countText }],
      'deferred hidden update',
    ),
  ).not.toThrow()

  const restored = await captureMutations(host, () => toggle.click())
  expect(host.querySelector('[data-panel]')).toBe(panel)
  expect(panel.style.display).toBe('')
  expect(count.textContent).toBe('2')
  expect(snapshot.textContent).toBe('2')
  expect(readSubscriptionCount()).toBe(1)
  expect(readEffectTrace()).toEqual([
    'connect:0:0',
    'disconnect:0:0',
    'connect:1:0',
    'disconnect:1:0',
    'connect:2:2',
  ])
  expect(() =>
    assertMutationEnvelope(
      restored.records,
      [
        { type: 'attributes', target: panel, attributeName: 'style' },
        { type: 'characterData', target: snapshotText },
      ],
      'restore retained panel',
    ),
  ).not.toThrow()
})
