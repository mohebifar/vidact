import { mountCompiled } from '@vidact/runtime'
import { act } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ConcurrentApp } from './ConcurrentApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

it('keeps urgent work responsive and suppresses stale deferred publication', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(ConcurrentApp, host).dispose
  const transition = host.querySelector<HTMLButtonElement>('[data-transition]')!
  const urgent = host.querySelector<HTMLButtonElement>('[data-urgent]')!
  const pending = host.querySelector<HTMLOutputElement>('[data-pending]')!
  const query = host.querySelector<HTMLOutputElement>('[data-query]')!
  const deferred = host.querySelector<HTMLOutputElement>('[data-deferred]')!
  const queryNode = query.firstChild
  const deferredNode = deferred.firstChild

  transition.click()
  expect(pending.textContent).toBe('pending')
  expect(query.textContent).toBe('initial')
  expect(deferred.textContent).toBe('initial')

  urgent.click()
  expect(query.textContent).toBe('urgent')
  expect(deferred.textContent).toBe('initial')
  await act(() => {})

  expect(pending.textContent).toBe('ready')
  expect(query.textContent).toBe('urgent')
  expect(deferred.textContent).toBe('urgent')
  expect(query.firstChild).toBe(queryNode)
  expect(deferred.firstChild).toBe(deferredNode)
})
