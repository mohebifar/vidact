import { hydrateRoot } from '@vidact/runtime/retained-ui/hydrate'
import {
  Activity as ServerActivity,
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  type ServerChild,
} from '@vidact/runtime/retained-ui/server'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { RetainedUiHydrationApp } from './RetainedUiHydrationApp.tsx'

function ServerApp(): ServerChild {
  return serverJsxs('main', {
    children: [
      serverJsx('button', { 'data-show': true, children: 'show' }),
      serverJsx(ServerActivity, {
        mode: 'hidden',
        children: () =>
          serverJsx('section', {
            'data-hydrated-panel': true,
            'data-vidact-activity-display': 'authored-display',
            'data-vidact-activity-priority': 'authored-priority',
            style: { color: 'red', display: 'grid' },
            children: serverJsx('output', { 'data-count': true, children: 3 }),
          }),
      }),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('claims initially hidden server DOM and reconnects it without remounting', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerApp, null))
  document.body.append(host)
  const panel = host.querySelector<HTMLElement>('[data-hydrated-panel]')!
  expect(panel.style.display).toBe('none')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, RetainedUiHydrationApp, {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )
  expect(recoveries).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('[data-hydrated-panel]')).toBe(panel)

  const restored = await captureMutations(host, () =>
    host.querySelector<HTMLButtonElement>('[data-show]')!.click(),
  )
  expect(host.querySelector('[data-hydrated-panel]')).toBe(panel)
  expect(panel.style.display).toBe('grid')
  expect(panel.style.color).toBe('red')
  expect(panel.dataset.vidactActivityDisplay).toBe('authored-display')
  expect(panel.dataset.vidactActivityPriority).toBe('authored-priority')
  expect(() =>
    assertMutationEnvelope(
      restored.records,
      [{ type: 'attributes', target: panel, attributeName: 'style' }],
      'restore hydrated Activity',
    ),
  ).not.toThrow()

  hydration.result.unmount()
})
