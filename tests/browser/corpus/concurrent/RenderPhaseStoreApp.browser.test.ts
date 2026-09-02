import { mountCompiled } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { RenderPhaseStoreApp } from './RenderPhaseStoreApp.tsx'

let mounted: { dispose: () => void } | undefined

afterEach(() => {
  mounted?.dispose()
  mounted = undefined
  document.body.replaceChildren()
})

it('publishes render-phase state through a layout-synchronized external store', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  mounted = mountCompiled(RenderPhaseStoreApp, host)

  const root = host.querySelector<HTMLElement>('[data-render-phase-store]')!
  const output = host.querySelector<HTMLOutputElement>('output')!
  const open = host.querySelector<HTMLButtonElement>('button')!

  expect(output.textContent).toBe('closed')
  expect(output.dataset.storeMounted).toBe('false')

  const mutation = await captureMutations(host, () => open.click())

  expect(host.querySelector('[data-render-phase-store]')).toBe(root)
  expect(host.querySelector('output')).toBe(output)
  expect(output.textContent).toBe('opening')
  expect(output.dataset.storeMounted).toBe('true')
  expect(() =>
    assertMutationEnvelope(
      mutation.records,
      [
        { type: 'attributes', target: output },
        { type: 'characterData', within: output },
      ],
      'concurrent render-phase store synchronization',
    ),
  ).not.toThrow()
})
