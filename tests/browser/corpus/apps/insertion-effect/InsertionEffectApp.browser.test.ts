import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import InsertionEffectApp, {
  readInsertionTrace,
  resetInsertionTrace,
} from './InsertionEffectApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetInsertionTrace()
  document.body.replaceChildren()
})

describe('compiled insertion effects', () => {
  it('runs before new refs and before layout work', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(InsertionEffectApp, host).dispose

    host.querySelector<HTMLButtonElement>('[data-toggle-child]')!.click()

    const output = host.querySelector<HTMLOutputElement>('[data-theme]')!
    const outputText = requireSingleDirectText(output)
    expect(readInsertionTrace()).toEqual(['insert:red:null', 'layout:red:red'])

    const themed = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle-theme]')!.click(),
    )

    expect(output.textContent).toBe('blue')
    expect(readInsertionTrace()).toEqual([
      'insert:red:null',
      'layout:red:red',
      'insert-cleanup:red',
      'insert:blue:attached',
      'layout-cleanup:red',
      'layout:blue:blue',
    ])
    expect(() =>
      assertMutationEnvelope(
        themed.records,
        [
          { type: 'attributes', target: output, attributeName: 'data-theme' },
          { type: 'characterData', target: outputText },
        ],
        'insertion effect dependency update',
      ),
    ).not.toThrow()
  })
})
