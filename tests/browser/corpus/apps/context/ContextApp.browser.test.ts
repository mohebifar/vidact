import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import ContextApp from './ContextApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled context', () => {
  it('inherits nearest providers across reactive values and late branches', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(ContextApp, host).dispose

    const defaultConsumer = host.querySelector<HTMLOutputElement>('[data-context="default"]')!
    const outerConsumer = host.querySelector<HTMLOutputElement>('[data-context="outer"]')!
    const nestedConsumer = host.querySelector<HTMLOutputElement>('[data-context="nested"]')!
    const outerText = requireSingleDirectText(outerConsumer)

    expect(defaultConsumer.textContent).toBe('default')
    expect(outerConsumer.textContent).toBe('red')
    expect(nestedConsumer.textContent).toBe('nested')
    expect(host.querySelector('[data-context="late"]')).toBeNull()

    host.querySelector<HTMLButtonElement>('[data-toggle-late]')!.click()

    const lateConsumer = host.querySelector<HTMLOutputElement>('[data-context="late"]')!
    const lateText = requireSingleDirectText(lateConsumer)
    expect(lateConsumer.textContent).toBe('red')

    const themed = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle-theme]')!.click(),
    )

    expect(defaultConsumer.textContent).toBe('default')
    expect(outerConsumer.textContent).toBe('blue')
    expect(lateConsumer.textContent).toBe('blue')
    expect(nestedConsumer.textContent).toBe('nested')
    expect(() =>
      assertMutationEnvelope(
        themed.records,
        [
          { type: 'attributes', target: outerConsumer, attributeName: 'data-value' },
          { type: 'characterData', target: outerText },
          { type: 'attributes', target: lateConsumer, attributeName: 'data-value' },
          { type: 'characterData', target: lateText },
        ],
        'context provider update',
      ),
    ).not.toThrow()

    host.querySelector<HTMLButtonElement>('[data-toggle-late]')!.click()
    host.querySelector<HTMLButtonElement>('[data-toggle-theme]')!.click()
    host.querySelector<HTMLButtonElement>('[data-toggle-late]')!.click()

    expect(host.querySelector('[data-context="late"]')?.textContent).toBe('red')
  })
})
