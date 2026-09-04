import {
  cloneRenderable,
  compiledRoot,
  createCompiledScope,
  type DirectComponent,
} from '@vidact/runtime'
import { createElement, hydrateRoot } from '@vidact/runtime/hydrate'
import {
  Fragment as ServerFragment,
  Suspense as ServerSuspense,
  createElement as createServerElement,
  jsx as serverJsx,
  lazy as serverLazy,
  renderToString,
  useState,
  type ServerChild,
  type ServerComponent,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import {
  LayoutRoute,
  LeafRoute,
  revealRoutePanel,
  routePanelModule,
} from './RouteLazyHydrationApp.tsx'

function ServerRoutePanel({ label }: { readonly label: string }): ServerChild {
  const [count] = useState(0)
  return serverJsx('div', {
    'data-panel': '',
    'data-count': count,
    children: serverJsx('button', { 'data-increment': '', children: label }),
  })
}

// The server resolves its own lazy module before rendering, as a framework would.
const serverPanelModule = Promise.resolve({ default: ServerRoutePanel })
const ServerPanel = serverLazy(() => serverPanelModule)

/** Compiled `<Suspense>` goes through `jsx(Suspense, …)`, not a direct call. */
function ServerLeafRoute({ label }: { readonly label: string }): ServerChild {
  // The compiler wraps a Suspense child in a Fragment on both targets.
  return serverJsx(ServerSuspense, {
    fallback: () => serverJsx('p', { 'data-fallback': '', children: 'loading' }),
    children: () => serverJsx(ServerFragment, { children: serverJsx(ServerPanel, { label }) }),
  })
}

function ServerStartRoot({ children }: { readonly children?: ServerChild }): ServerChild {
  return children
}

function ServerLayoutRoute({ children }: { readonly children?: ServerChild }): ServerChild {
  return serverJsx(ServerFragment, { children })
}

afterEach(() => document.body.replaceChildren())

it("dehydrates a compiled Suspense boundary that is a route component's whole output", async () => {
  // First pass primes the server lazy resource; the second renders resolved content.
  // The client mounts the application under its own compiled root, which claims a
  // component range — so the server renders a matching root component around it.
  const compose = () =>
    createServerElement(ServerStartRoot, {
      children: createServerElement(ServerLayoutRoute, {
        children: createServerElement(ServerLeafRoute as ServerComponent, { label: 'go' }),
      }),
    })
  renderToString(compose)
  await serverPanelModule
  const serverMarkup = renderToString(compose)
  expect(serverMarkup).not.toContain('data-fallback')

  const host = document.createElement('div')
  host.innerHTML = serverMarkup
  document.body.append(host)
  const serverPanel = host.querySelector('[data-panel]')
  if (serverPanel === null) throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

  // Routes are composed with createElement and mounted through a compiled root, the way
  // @vidact/start's client does it.
  const application = createElement(LayoutRoute, {
    children: createElement(LeafRoute as DirectComponent, { label: 'go' }),
  })
  const hydration = await captureMutations(host, () =>
    hydrateRoot(
      host,
      () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () => cloneRenderable(application))
      },
      { onRecoverableError: (error) => recoveries.push(error) },
    ),
  )

  expect(recoveries.map(String)).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('[data-fallback]')).toBeNull()
  expect(host.querySelector('[data-panel]')).toBe(serverPanel)

  revealRoutePanel()
  await routePanelModule
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(host.querySelector('[data-fallback]')).toBeNull()
  expect(serverPanel.isConnected).toBe(false)
  const panel = host.querySelector('[data-panel]')
  host.querySelector<HTMLButtonElement>('[data-increment]')!.click()
  expect(panel?.getAttribute('data-count')).toBe('1')

  hydration.result.unmount()
})
