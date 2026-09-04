import {
  cloneRenderable,
  compiledRoot,
  createCompiledScope,
  type DirectComponent,
} from '@vidact/runtime'
import { createElement, hydrateRoot } from '@vidact/runtime/hydrate'
import {
  Fragment as ServerFragment,
  createElement as createServerElement,
  jsx as serverJsx,
  renderToString,
  useState,
  type ServerChild,
  type ServerComponent,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { LayoutRoute, LeafRoute } from './ConditionalComponentApp.tsx'

/**
 * The runtime's component types take an untyped props record, so a component written with
 * typed props needs a cast at the call site. The framework does the same internally.
 */
function ServerCounter({ label }: { readonly label: string }): ServerChild {
  const [count] = useState(0)
  return serverJsx('div', {
    'data-panel': '',
    'data-count': count,
    children: serverJsx('button', { 'data-increment': '', children: label }),
  })
}

function ServerLeafRoute({ label }: { readonly label: string }): ServerChild {
  return serverJsx(ServerCounter as ServerComponent, { label })
}

function ServerLayoutRoute({ children }: { readonly children?: ServerChild }): ServerChild {
  return serverJsx(ServerFragment, { children })
}

function ServerStartRoot({ children }: { readonly children?: ServerChild }): ServerChild {
  return children
}

afterEach(() => document.body.replaceChildren())

it('hydrates a component returned from a conditional route body', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() =>
    createServerElement(ServerStartRoot, {
      children: createServerElement(ServerLayoutRoute, {
        children: createServerElement(ServerLeafRoute as ServerComponent, { label: 'go' }),
      }),
    }),
  )
  document.body.append(host)
  const panel = host.querySelector('[data-panel]')
  if (panel === null) throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

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
  expect(host.querySelector('[data-panel]')).toBe(panel)

  host.querySelector<HTMLButtonElement>('[data-increment]')!.click()
  expect(panel.getAttribute('data-count')).toBe('1')

  hydration.result.unmount()
})
