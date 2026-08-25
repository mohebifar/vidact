import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  Profiler as ServerProfiler,
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  type ServerChild,
} from '@vidact/runtime/server'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import {
  ProfilingHydrationApp,
  readHydrationProfilePhases,
  resetHydrationProfilePhases,
} from './ProfilingHydrationApp.tsx'

function ServerApp(): ServerChild {
  return serverJsx('main', {
    children: serverJsx(ServerProfiler, {
      id: 'hydrated',
      onRender: () => undefined,
      children: () => serverJsx(ServerCounter, null),
    }),
  })
}

function ServerCounter(): ServerChild {
  return serverJsxs('section', {
    'data-hydrated-profile': true,
    children: [
      serverJsx('button', { 'data-increment': true, children: 'increment' }),
      serverJsx('output', { 'data-count': true, children: 0 }),
    ],
  })
}

afterEach(() => {
  resetHydrationProfilePhases()
  document.body.replaceChildren()
})

it('claims a profiled server range without churn and profiles later updates', async () => {
  const host = document.createElement('div')
  host.innerHTML = renderToString(() => serverJsx(ServerApp, null))
  document.body.append(host)
  const section = host.querySelector<HTMLElement>('[data-hydrated-profile]')!
  const count = section.querySelector<HTMLOutputElement>('[data-count]')!
  const countText = requireSingleDirectText(count)
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, ProfilingHydrationApp, {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )
  expect(recoveries).toEqual([])
  expect(hydration.records).toHaveLength(0)
  expect(host.querySelector('[data-hydrated-profile]')).toBe(section)
  expect(readHydrationProfilePhases()).toEqual(['mount'])

  const update = await captureMutations(host, () =>
    section.querySelector<HTMLButtonElement>('[data-increment]')!.click(),
  )
  expect(count.textContent).toBe('1')
  expect(host.querySelector('[data-hydrated-profile]')).toBe(section)
  expect(readHydrationProfilePhases()).toEqual(['mount', 'update'])
  expect(() =>
    assertMutationEnvelope(
      update.records,
      [{ type: 'characterData', target: countText }],
      'hydrated profiled update',
    ),
  ).not.toThrow()

  hydration.result.unmount()
})
