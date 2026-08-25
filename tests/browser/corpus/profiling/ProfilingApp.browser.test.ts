import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import {
  ProfilingApp,
  readLatestOwnerStack,
  readProfileCommits,
  readStandaloneOwnerStack,
  resetProfilingTrace,
} from './ProfilingApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetProfilingTrace()
  document.body.replaceChildren()
})

it('profiles compiled work without remounting unrelated DOM', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(ProfilingApp, host).dispose

  const button = host.querySelector<HTMLButtonElement>('[data-increment]')!
  const captureOwner = host.querySelector<HTMLButtonElement>('[data-capture-owner]')!
  const captureStandalone = host.querySelector<HTMLButtonElement>('[data-capture-standalone]')!
  const count = host.querySelector<HTMLOutputElement>('[data-count]')!
  const countText = requireSingleDirectText(count)
  const stable = host.querySelector<HTMLElement>('[data-stable]')!
  const mount = readProfileCommits()[0]!
  expect(mount[0]).toBe('counter')
  expect(mount[1]).toBe('mount')
  expect(mount[2]).toBeGreaterThanOrEqual(0)
  expect(mount[3]).toBe(mount[2])
  expect(mount[5]).toBeGreaterThanOrEqual(mount[4])
  expect(readProfileCommits().map((commit) => `${commit[0]}:${commit[1]}`)).toEqual([
    'counter:mount',
    'root:mount',
  ])

  const mutation = await captureMutations(host, () => button.click())
  expect(count.textContent).toBe('1')
  expect(host.querySelector('[data-stable]')).toBe(stable)
  expect(readProfileCommits().map((commit) => `${commit[0]}:${commit[1]}`)).toEqual([
    'counter:mount',
    'root:mount',
    'counter:update',
    'root:update',
  ])
  captureOwner.click()
  expect(readLatestOwnerStack()).toContain('ProfiledCounter [count:1]')
  captureStandalone.click()
  expect(readStandaloneOwnerStack()).toContain('StandaloneDebugValue [standalone]')
  expect(() =>
    assertMutationEnvelope(
      mutation.records,
      [{ type: 'characterData', target: countText }],
      'profiled counter update',
    ),
  ).not.toThrow()

  const measures = performance.getEntriesByType('measure').map((entry) => entry.name)
  expect(measures.some((name) => name.startsWith('vidact.range:ProfiledCounter'))).toBe(true)
  expect(measures.some((name) => name.startsWith('vidact.updater:ProfiledCounter'))).toBe(true)
  expect(measures.some((name) => name.startsWith('vidact.effect:ProfiledCounter'))).toBe(true)
  expect(measures.some((name) => name.startsWith('vidact.scheduler:ProfiledCounter'))).toBe(true)
})
