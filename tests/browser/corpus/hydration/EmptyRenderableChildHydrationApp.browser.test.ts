import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  type ServerChild,
} from '@vidact/runtime/server'
import { captureMutations, describeMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { EmptyRenderableChildHydrationApp } from './EmptyRenderableChildHydrationApp.tsx'

function ServerOptionalChildren({ children }: { readonly children?: ServerChild }): ServerChild {
  return serverJsx('svg', {
    'aria-hidden': 'true',
    className: 'lucide lucide-arrow-right size-4',
    'data-optional-children': '',
    fill: 'none',
    height: 24,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2,
    viewBox: '0 0 24 24',
    width: 24,
    xmlns: 'http://www.w3.org/2000/svg',
    children: [
      serverJsx('path', { d: 'M5 12h14' }, 'line'),
      serverJsx('path', { d: 'm12 5 7 7-7 7' }, 'arrow'),
      children,
    ],
  })
}

function ServerArrowIcon(props: Record<string, unknown>): ServerChild {
  return serverJsx(ServerOptionalChildren, props)
}

function ServerFrame({ children }: { readonly children?: ServerChild }): ServerChild {
  return serverJsx('section', { children })
}

function ServerEmptyRenderableChildHydrationApp(): ServerChild {
  return serverJsxs(ServerFrame, {
    children: [
      'Icon ',
      serverJsx(ServerArrowIcon, {
        className: 'size-4',
        'data-optional-children': '',
      }),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('hydrates an empty deferred component child inside an array', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerEmptyRenderableChildHydrationApp, null))
  document.body.append(host)
  const svg = host.querySelector('[data-optional-children]')
  const path = host.querySelector('path')
  if (svg === null || path === null) throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(
    host,
    () =>
      hydrateRoot(host, EmptyRenderableChildHydrationApp, {
        onRecoverableError: (error) => recoveries.push(error),
      }),
    { observe: { attributes: false } },
  )

  expect(recoveries.map(String)).toEqual([])
  expect(describeMutations(hydration.records)).toEqual([])
  expect(host.querySelector('[data-optional-children]')).toBe(svg)
  expect(host.querySelector('path')).toBe(path)

  hydration.result.unmount()
})
