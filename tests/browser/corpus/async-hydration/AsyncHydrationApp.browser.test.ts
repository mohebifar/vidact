import { hydrateRoot } from '@vidact/runtime/async/hydrate'
import {
  Suspense as ServerSuspense,
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  use as serverUse,
  type ServerChild,
} from '@vidact/runtime/server'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import {
  AsyncHydrationApp,
  message,
  nextMessage,
  revealMessage,
  revealNextMessage,
} from './AsyncHydrationApp.tsx'

function ServerAsyncMessage(): ServerChild {
  return serverJsx('div', {
    'data-content': '',
    'data-count': 0,
    children: serverJsx('strong', { children: serverUse(message) }),
  })
}

function ServerAsyncHydrationApp(): ServerChild {
  return serverJsxs('div', {
    children: [
      serverJsx('button', { 'data-increment': '', children: 'increment' }),
      serverJsx('button', { 'data-refresh': '', children: 'refresh' }),
      serverJsx('div', {
        'data-inline-conditional': '',
        children: serverJsx('p', { children: 'inside conditional' }),
      }),
      serverJsx('p', { 'data-after-conditional': '', children: 'after conditional' }),
      ServerSuspense({
        children: () => serverJsx(ServerAsyncMessage, null),
        fallback: () => serverJsx('p', { 'data-fallback': '', children: 'loading' }),
      }),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('claims a pending server fallback and atomically reveals fulfilled content', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerAsyncHydrationApp, null))
  document.body.append(host)
  const fallback = host.querySelector('[data-fallback]')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, AsyncHydrationApp, {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )
  expect(recoveries).toEqual([])
  expect(
    hydration.records.map((record) => ({
      added: [...record.addedNodes].map((node) => node.nodeName),
      removed: [...record.removedNodes].map((node) => node.nodeName),
      target: (record.target as Element).nodeName,
      type: record.type,
    })),
  ).toEqual([])
  expect(host.querySelector('[data-fallback]')).toBe(fallback)

  const reveal = await captureMutations(host, async () => {
    revealMessage()
    await message
    await Promise.resolve()
  })
  expect(fallback?.isConnected).toBe(false)
  expect(host.querySelector('[data-content]')?.textContent).toBe('ready')
  expect(reveal.records.length).toBeGreaterThan(0)

  const content = host.querySelector('[data-content]')
  const increment = host.querySelector<HTMLButtonElement>('[data-increment]')
  if (content === null || increment === null) throw new Error('fulfilled controls must exist')
  expect(content.getAttribute('data-count')).toBe('0')
  const update = await captureMutations(host, () => increment.click())
  expect(host.querySelector('[data-content]')).toBe(content)
  expect(content.getAttribute('data-count')).toBe('1')
  expect(() =>
    assertMutationEnvelope(
      update.records,
      [{ type: 'attributes', target: content, attributeName: 'data-count' }],
      'reactive Suspense child prop update',
    ),
  ).not.toThrow()

  const refresh = host.querySelector<HTMLButtonElement>('[data-refresh]')
  if (refresh === null) throw new Error('refresh control must exist')
  refresh.click()
  expect(host.querySelector('[data-fallback]')?.textContent).toBe('loading')
  expect(host.querySelector('[data-content]')).toBeNull()
  revealNextMessage()
  await nextMessage
  await Promise.resolve()
  expect(host.querySelector('[data-fallback]')).toBeNull()
  expect(host.querySelector('[data-content]')?.textContent).toBe('updated')
  hydration.result.unmount()

  const fulfilledHost = document.createElement('div')
  fulfilledHost.innerHTML = renderToString(() => serverJsx(ServerAsyncHydrationApp, null))
  document.body.append(fulfilledHost)
  const fulfilledContent = fulfilledHost.querySelector('[data-content]')
  const fulfilledRecoveries: unknown[] = []
  const fulfilledHydration = await captureMutations(fulfilledHost, () =>
    hydrateRoot(fulfilledHost, AsyncHydrationApp, {
      onRecoverableError: (error) => fulfilledRecoveries.push(error),
    }),
  )
  expect(fulfilledRecoveries).toEqual([])
  expect(fulfilledHydration.records).toHaveLength(0)
  expect(fulfilledHost.querySelector('[data-content]')).toBe(fulfilledContent)
  fulfilledHydration.result.unmount()
})
