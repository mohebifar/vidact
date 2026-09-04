import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  Suspense as ServerSuspense,
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  type ServerChild,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { LazyHydrationApp, panelModule, revealPanel } from './LazyHydrationApp.tsx'

function ServerLazyPanel(): ServerChild {
  return serverJsx('section', { 'data-panel': '', 'data-count': 0, children: 'panel' })
}

function ServerLazyHydrationApp(): ServerChild {
  return serverJsxs('div', {
    children: [
      serverJsx('button', { 'data-increment': '', children: 'increment' }),
      ServerSuspense({
        children: () => serverJsx(ServerLazyPanel, null),
        fallback: () => serverJsx('p', { 'data-fallback': '', children: 'loading' }),
      }),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('keeps server content on screen while a lazy child loads, then swaps it in', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerLazyHydrationApp, null))
  document.body.append(host)
  const serverPanel = host.querySelector('[data-panel]')
  const increment = host.querySelector<HTMLButtonElement>('[data-increment]')
  if (serverPanel === null || increment === null) throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, LazyHydrationApp, {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )

  // The chunk is still pending: no recovery, no fallback, the server DOM untouched.
  expect(recoveries.map(String)).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('[data-fallback]')).toBeNull()
  expect(host.querySelector('[data-panel]')).toBe(serverPanel)

  // The hydrated part of the page is already interactive.
  increment.click()
  expect(serverPanel.getAttribute('data-count')).toBe('0')

  const reveal = await captureMutations(host, async () => {
    revealPanel()
    await panelModule
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  expect(host.querySelector('[data-fallback]')).toBeNull()
  expect(serverPanel.isConnected).toBe(false)
  const panel = host.querySelector('[data-panel]')
  expect(panel?.getAttribute('data-count')).toBe('1')
  expect(reveal.records.length).toBeGreaterThan(0)

  increment.click()
  expect(host.querySelector('[data-panel]')).toBe(panel)
  expect(panel?.getAttribute('data-count')).toBe('2')

  hydration.result.unmount()
})
