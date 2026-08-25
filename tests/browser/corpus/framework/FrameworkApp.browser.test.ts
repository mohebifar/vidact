import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { FrameworkApp } from './FrameworkApp.tsx'

let dispose: (() => void) | undefined
const originalTitle = document.title

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

it('hoists compiler-detected metadata and updates it without remounting body content', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(FrameworkApp, host).dispose

  const main = host.querySelector('main')!
  const output = host.querySelector('output')!
  const outputText = requireSingleDirectText(output)
  expect(document.title).toBe('Framework 0')
  expect(
    document.head.querySelector('meta[name="vidact-framework-count"]')?.getAttribute('content'),
  ).toBe('0')

  const mutation = await captureMutations(host, () =>
    host.querySelector<HTMLButtonElement>('[data-increment]')!.click(),
  )
  expect(host.querySelector('main')).toBe(main)
  expect(document.title).toBe('Framework 1')
  expect(
    document.head.querySelector('meta[name="vidact-framework-count"]')?.getAttribute('content'),
  ).toBe('1')
  expect(() =>
    assertMutationEnvelope(
      mutation.records,
      [{ type: 'characterData', target: outputText }],
      'framework metadata update',
    ),
  ).not.toThrow()

  dispose()
  dispose = undefined
  expect(document.title).toBe(originalTitle)
  expect(document.head.querySelector('meta[name="vidact-framework-count"]')).toBeNull()
})
