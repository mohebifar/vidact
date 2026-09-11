import { hydrateRoot } from '@vidact/runtime/hydrate'
import { jsx as serverJsx, renderToString, type ServerChild } from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ForwardedConditionalHydrationApp } from './ForwardedConditionalHydrationApp.tsx'

function ServerAlternateBranch(): ServerChild {
  return serverJsx('p', { 'data-alternate-branch': '', children: 'Alternate' })
}

function ServerPanel({ children }: { readonly children?: ServerChild }): ServerChild {
  return serverJsx('div', { 'data-conditional-panel': '', children })
}

function ServerForwardedConditionalHydrationApp(): ServerChild {
  return serverJsx(ServerPanel, { children: serverJsx(ServerAlternateBranch, null) })
}

afterEach(() => document.body.replaceChildren())

it('shares one server slot across forwarded and conditional child wrappers', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerForwardedConditionalHydrationApp, null))
  document.body.append(host)
  const panel = host.querySelector('[data-conditional-panel]')
  const branch = host.querySelector('[data-alternate-branch]')
  if (panel === null || branch === null) throw new Error('server markup is incomplete')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, () => ForwardedConditionalHydrationApp({ mode: 'alternate' }), {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )

  expect(recoveries.map(String)).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('[data-conditional-panel]')).toBe(panel)
  expect(host.querySelector('[data-alternate-branch]')).toBe(branch)

  hydration.result.unmount()
})
