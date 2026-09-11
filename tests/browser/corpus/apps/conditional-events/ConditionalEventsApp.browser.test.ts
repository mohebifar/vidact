import { mountCompiled } from '@vidact/runtime'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ConditionalEventsApp } from './ConditionalEventsApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

it('switches a conditional event expression without replacing its element', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(ConditionalEventsApp, host).dispose

  const action = host.querySelector<HTMLButtonElement>('[data-conditional-event]')!
  const trace = host.querySelector<HTMLOutputElement>('[data-event-trace]')!
  action.click()
  expect(trace.textContent).toBe('2')

  const switched = await captureMutations(host, () =>
    host.querySelector<HTMLButtonElement>('[data-switch-event]')!.click(),
  )
  expect(host.querySelector('[data-conditional-event]')).toBe(action)
  expect(switched.records).toEqual([])

  action.click()
  expect(trace.textContent).toBe('21')
})

it('keeps keyed rows stable and replaces a row when its keyed component type changes', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(ConditionalEventsApp, host).dispose

  const first = host.querySelector<HTMLButtonElement>('[data-row-id="first"]')!
  const stable = host.querySelector<HTMLButtonElement>('[data-row-id="stable"]')!
  const trace = host.querySelector<HTMLOutputElement>('[data-event-trace]')!
  first.click()
  stable.click()
  expect(trace.textContent).toBe('ab')

  const switched = await captureMutations(host, () =>
    host.querySelector<HTMLButtonElement>('[data-switch-row]')!.click(),
  )
  const nextFirst = host.querySelector<HTMLButtonElement>('[data-row-id="first"]')!
  expect(nextFirst).not.toBe(first)
  expect(nextFirst.dataset.rowType).toBe('b')
  expect(host.querySelector('[data-row-id="stable"]')).toBe(stable)
  expect(switched.records.some((record) => record.type === 'childList')).toBe(true)

  nextFirst.click()
  stable.click()
  expect(trace.textContent).toBe('abbb')
})
