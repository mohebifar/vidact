import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import UseIdApp from './UseIdApp.tsx'

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0).toReversed()) dispose()
  document.body.replaceChildren()
})

describe('compiled useId', () => {
  it('allocates stable deterministic IDs from each logical root', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    disposers.push(mountCompiled(UseIdApp, host, { identifierPrefix: 'test-' }).dispose)

    const initial = host.querySelector<HTMLElement>('[data-field="initial"]')!
    const initialLabel = initial.querySelector<HTMLLabelElement>('label')!
    const initialInput = initial.querySelector<HTMLInputElement>('input')!
    const initialHint = initial.querySelector<HTMLElement>('small')!
    const count = host.querySelector<HTMLOutputElement>('[data-count]')!
    const countText = requireSingleDirectText(count)

    expect(initialInput.id).toBe(':test-r0:')
    expect(initialHint.id).toBe(':test-r1:')
    expect(initialLabel.htmlFor).toBe(initialInput.id)
    expect(initialInput.getAttribute('aria-describedby')).toBe(initialHint.id)

    const incremented = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-increment]')!.click(),
    )

    expect(initialInput.id).toBe(':test-r0:')
    expect(() =>
      assertMutationEnvelope(
        incremented.records,
        [
          { type: 'attributes', target: count, attributeName: 'data-count' },
          { type: 'characterData', target: countText },
        ],
        'useId unrelated update',
      ),
    ).not.toThrow()

    host.querySelector<HTMLButtonElement>('[data-toggle-late]')!.click()
    const firstLateInput = host.querySelector<HTMLInputElement>('[data-field="late"] input')!
    expect(firstLateInput.id).toBe(':test-r2:')

    host.querySelector<HTMLButtonElement>('[data-toggle-late]')!.click()
    host.querySelector<HTMLButtonElement>('[data-toggle-late]')!.click()
    const secondLateInput = host.querySelector<HTMLInputElement>('[data-field="late"] input')!
    expect(secondLateInput.id).toBe(':test-r4:')

    const secondHost = document.createElement('div')
    document.body.append(secondHost)
    disposers.push(mountCompiled(UseIdApp, secondHost, { identifierPrefix: 'other-' }).dispose)
    expect(secondHost.querySelector<HTMLInputElement>('[data-field="initial"] input')?.id).toBe(
      ':other-r0:',
    )
  })
})
