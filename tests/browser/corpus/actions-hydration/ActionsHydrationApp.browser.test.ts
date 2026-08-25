import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  useActionState as useServerActionState,
  useFormStatus as useServerFormStatus,
  type ServerChild,
} from '@vidact/runtime/server'
import { act, assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ActionsHydrationApp } from './ActionsHydrationApp.tsx'

function ServerStatus(): ServerChild {
  const status = useServerFormStatus()
  return serverJsx('span', {
    'data-status': true,
    children: status.pending ? 'pending' : 'idle',
  })
}

function ServerApp(): ServerChild {
  const [value, submit, pending] = useServerActionState(
    async (_previous: string, data: FormData) => String(data.get('value')),
    'initial',
    '/save',
  )
  return serverJsxs('form', {
    action: submit,
    children: [
      serverJsx('input', { name: 'value', defaultValue: 'initial' }),
      serverJsx('button', { type: 'submit', children: 'save' }),
      serverJsx('span', { 'data-pending': true, children: pending ? 'pending' : 'idle' }),
      serverJsx('span', { 'data-value': true, children: value }),
      serverJsx(ServerStatus, {}),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('claims server permalink markup and activates the form Action in place', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerApp, {}))
  document.body.append(host)
  const form = host.querySelector('form')!
  const input = form.elements.namedItem('value') as HTMLInputElement
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, ActionsHydrationApp, {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )
  expect(recoveries).toEqual([])
  expect(() =>
    assertMutationEnvelope(
      hydration.records,
      [{ type: 'attributes', target: form, attributeName: 'action' }],
      'Actions hydration activation',
    ),
  ).not.toThrow()
  expect(host.querySelector('form')).toBe(form)
  expect(form.getAttribute('action')).toBeNull()

  input.value = 'hydrated'
  form.querySelector<HTMLButtonElement>('button')!.click()
  expect(host.querySelector('[data-pending]')?.textContent).toBe('pending')
  expect(host.querySelector('[data-status]')?.textContent).toBe('pending')
  await act(() => {})
  expect(host.querySelector('[data-value]')?.textContent).toBe('hydrated')
  expect(host.querySelector('[data-pending]')?.textContent).toBe('idle')
  expect(host.querySelector('[data-status]')?.textContent).toBe('idle')
  expect(input.value).toBe('initial')
  expect(host.querySelector('form')).toBe(form)
  hydration.result.unmount()
})
