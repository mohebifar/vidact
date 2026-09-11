import { hydrateRoot } from '@vidact/runtime/hydrate'
import { jsx as serverJsx, renderToString, type ServerChild } from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ArrayConditionalHydrationApp } from './ArrayConditionalHydrationApp.tsx'

function ServerArrow(): ServerChild {
  return serverJsx('i', { 'data-array-arrow': '', children: '→' })
}

function ServerWrapper({ children }: { readonly children?: ServerChild }): ServerChild {
  return serverJsx('a', { href: '/next', children })
}

function ServerArrayConditionalHydrationApp(): ServerChild {
  return serverJsx(ServerWrapper, {
    children: serverJsx('span', {
      'data-array-conditional': '',
      children: [
        '\n        ',
        null,
        '\n        Title\n        ',
        serverJsx(ServerArrow, null),
        '\n      ',
      ],
    }),
  })
}

afterEach(() => document.body.replaceChildren())

it('hydrates conditional choices that are direct array items', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerArrayConditionalHydrationApp, null))
  document.body.append(host)
  const label = host.querySelector('[data-array-conditional]')
  const arrow = host.querySelector('[data-array-arrow]')
  if (label === null || arrow === null) throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, () => ArrayConditionalHydrationApp({ direction: 'next' }), {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )

  expect(recoveries.map(String)).toEqual([])
  expect(host.querySelector('[data-array-conditional]')).toBe(label)
  expect(host.querySelector('[data-array-arrow]')).toBe(arrow)
  expect(
    hydration.records.every(
      (record) =>
        (record.type === 'characterData' && record.target instanceof Text) ||
        (record.type === 'childList' &&
          record.target === label &&
          [...record.addedNodes].every((node) => node instanceof Comment || node instanceof Text) &&
          record.removedNodes.length === 0),
    ),
  ).toBe(true)

  hydration.result.unmount()
})
