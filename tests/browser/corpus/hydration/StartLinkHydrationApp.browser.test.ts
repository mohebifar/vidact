import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  type ServerChild,
  type ServerComponent,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { Link as ServerLink } from '../../../../packages/start/src/link.ts'
import { StartLinkHydrationApp } from './StartLinkHydrationApp.tsx'

function ServerSearchIcon(): ServerChild {
  return serverJsx('svg', {
    'aria-hidden': 'true',
    'data-search-icon': '',
    viewBox: '0 0 24 24',
    children: serverJsx('circle', { cx: '10.5', cy: '10.5', r: '6.5' }),
  })
}

function ServerStartLinkHydrationApp(): ServerChild {
  return serverJsxs('nav', {
    children: [
      serverJsx(ServerLink as unknown as ServerComponent, {
        href: '/docs',
        children: 'Docs',
      }),
      serverJsx(ServerSearchIcon, null),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('keeps hydration ranges aligned after a Start Link and before an SVG component', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerStartLinkHydrationApp, null))
  document.body.append(host)
  const link = host.querySelector('a')
  const icon = host.querySelector('[data-search-icon]')
  const circle = host.querySelector('circle')
  if (link === null || icon === null || circle === null)
    throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(
    host,
    () =>
      hydrateRoot(host, StartLinkHydrationApp, {
        onRecoverableError: (error) => recoveries.push(error),
      }),
    { observe: { attributes: false } },
  )

  expect(recoveries.map(String)).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('a')).toBe(link)
  expect(host.querySelector('[data-search-icon]')).toBe(icon)
  expect(host.querySelector('circle')).toBe(circle)

  hydration.result.unmount()
})
