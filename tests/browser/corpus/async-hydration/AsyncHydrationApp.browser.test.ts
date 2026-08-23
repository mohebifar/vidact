import { hydrateRoot } from '@vidact/runtime/async/hydrate'
import {
  Suspense as ServerSuspense,
  jsx as serverJsx,
  renderToString,
  use as serverUse,
  type ServerChild,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { AsyncHydrationApp, message, revealMessage } from './AsyncHydrationApp.tsx'

function ServerAsyncMessage(): ServerChild {
  return serverJsx('strong', { 'data-content': '', children: serverUse(message) })
}

function ServerAsyncHydrationApp(): ServerChild {
  return ServerSuspense({
    children: () => serverJsx(ServerAsyncMessage, null),
    fallback: () => serverJsx('p', { 'data-fallback': '', children: 'loading' }),
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
  hydration.result.unmount()

  const fulfilledHost = document.createElement('div')
  fulfilledHost.innerHTML = renderToString(() => serverJsx(ServerAsyncHydrationApp, null))
  document.body.append(fulfilledHost)
  const content = fulfilledHost.querySelector('[data-content]')
  const fulfilledHydration = await captureMutations(fulfilledHost, () =>
    hydrateRoot(fulfilledHost, AsyncHydrationApp),
  )
  expect(fulfilledHydration.records).toHaveLength(0)
  expect(fulfilledHost.querySelector('[data-content]')).toBe(content)
  fulfilledHydration.result.unmount()
})
