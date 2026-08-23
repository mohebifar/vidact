import { mountCompiled } from '@vidact/runtime/actions'
import {
  act,
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ActionsApp, finishAction } from './ActionsApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

it('runs compiled form Actions without remounting unrelated DOM', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(ActionsApp, host).dispose
  const form = host.querySelector('form')!
  const input = form.elements.namedItem('title') as HTMLInputElement
  const submit = form.querySelector('button')!
  const increment = host.querySelector<HTMLButtonElement>('[data-increment]')!
  const pending = host.querySelector('[data-pending]')!
  const count = host.querySelector('[data-count]')!
  const saved = host.querySelector('[data-saved]')!
  const optimistic = host.querySelector('[data-optimistic]')!
  const formStatus = host.querySelector('[data-form-status]')!
  const optimisticText = requireSingleDirectText(optimistic)
  const statusText = requireSingleDirectText(formStatus)
  input.value = 'draft'

  const capture = await captureMutations(host, () => submit.click())
  expect(pending.textContent).toBe('idle')
  expect(saved.textContent).toBe('initial')
  expect(optimistic.textContent).toBe('draft')
  expect(formStatus.textContent).toBe('pending:draft')
  expect(host.querySelector('form')).toBe(form)
  expect(() =>
    assertMutationEnvelope(
      capture.records,
      [
        { type: 'characterData', target: optimisticText },
        { type: 'characterData', target: statusText },
      ],
      'compiled form Action start',
    ),
  ).not.toThrow()

  finishAction()
  await act(() => {})
  expect(pending.textContent).toBe('idle')
  expect(saved.textContent).toBe('draft')
  expect(optimistic.textContent).toBe('draft')
  expect(formStatus.textContent).toBe('idle:none')
  expect(input.value).toBe('initial')
  expect(host.querySelector('form')).toBe(form)
  expect(host.querySelector('[data-saved]')).toBe(saved)

  increment.click()
  expect(pending.textContent).toBe('pending')
  await act(() => {})
  expect(pending.textContent).toBe('idle')
  expect(count.textContent).toBe('1')
  expect(host.querySelector('[data-count]')).toBe(count)

  input.value = 'spread'
  host.querySelector<HTMLButtonElement>('[data-forwarded-submit]')!.click()
  await act(() => {})
  expect(saved.textContent).toBe('forwarded:spread')
  expect(input.value).toBe('initial')
  expect(host.querySelector('form')).toBe(form)
})
