import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  useState,
  type ServerChild,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { ElementClaimApp } from './ElementClaimApp.tsx'

function ServerCounter(): ServerChild {
  const [count] = useState(0)
  return serverJsx('div', {
    'data-panel': '',
    children: serverJsx('button', { 'data-increment': '', children: count }),
  })
}

function ServerElementClaimApp(): ServerChild {
  return serverJsxs('section', {
    children: [
      serverJsx('div', { 'data-host': '', children: serverJsx(ServerCounter, null) }),
      serverJsx('div', {
        className: 'toolbar',
        children: ['one', 'two'].map((item) => serverJsx('span', { children: item }, item)),
      }),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('claims a structural wrapper by position, not by the nearest array marker', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerElementClaimApp, null))
  document.body.append(host)
  const wrapper = host.querySelector('[data-host]')
  const toolbar = host.querySelector('.toolbar')
  const panel = host.querySelector('[data-panel]')
  if (wrapper === null || toolbar === null || panel === null) throw new Error('markup incomplete')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, () => ElementClaimApp({}), {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )

  expect(recoveries.map(String)).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('[data-host]')).toBe(wrapper)
  expect(toolbar.hasAttribute('data-host')).toBe(false)
  expect(host.querySelector('[data-panel]')).toBe(panel)

  host.querySelector<HTMLButtonElement>('[data-increment]')!.click()
  expect(panel.textContent).toBe('1')

  hydration.result.unmount()
})
