import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  createContext as createServerContext,
  renderToString,
  useId,
  useState,
  type ServerChild,
} from '@vidact/runtime/server'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { HydrationApp } from './HydrationApp.tsx'

const initialItems = [
  { id: 1, label: 'one' },
  { id: 2, label: 'two' },
] as const

const ServerTheme = createServerContext('default')

function ServerHydrationContent(): ServerChild {
  const [items] = useState(initialItems)
  const labelId = useId()
  return serverJsxs('section', {
    children: [
      serverJsx('h1', { id: labelId, children: 'Hydrated list' }),
      serverJsx('button', { children: 'Reverse' }),
      serverJsx('ul', {
        'aria-labelledby': labelId,
        children: items.map((item) => serverJsx('li', { children: item.label }, item.id)),
      }),
    ],
  })
}

function ServerHydrationApp(): ServerChild {
  return serverJsx(ServerTheme.Provider, {
    value: 'red',
    children: serverJsx(ServerHydrationContent, null),
  })
}

afterEach(() => document.body.replaceChildren())

it('hydrates through a transparent context provider and updates surgically', async () => {
  const host = document.createElement('div')
  const serverMarkup = renderToString(() => serverJsx(ServerHydrationApp, null), {
    identifierPrefix: 'e2e-',
  })
  host.innerHTML = serverMarkup
  document.body.append(host)
  const section = host.querySelector('section')!
  const list = host.querySelector('ul')!
  const rows = [...host.querySelectorAll('li')]
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, () => HydrationApp({ initialItems }), {
      identifierPrefix: 'e2e-',
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )

  expect(recoveries).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('section')).toBe(section)
  expect([...host.querySelectorAll('li')]).toEqual(rows)
  expect(host.querySelector('h1')?.id).toBe(':e2e-r0:')

  const update = await captureMutations(host, () => host.querySelector('button')!.click())
  expect([...host.querySelectorAll('li')]).toEqual([rows[1], rows[0]])
  expect(update.records.length).toBeGreaterThan(0)
  expect(() =>
    assertMutationEnvelope(
      update.records,
      [{ type: 'childList', target: list }],
      'hydrated keyed reorder',
    ),
  ).not.toThrow()

  hydration.result.unmount()
})
