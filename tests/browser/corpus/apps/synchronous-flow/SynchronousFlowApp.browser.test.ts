import { mountCompiled } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { SynchronousFlowApp } from './SynchronousFlowApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled synchronous regions', () => {
  it('preserves switch fallthrough and loop completion in static updaters', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(SynchronousFlowApp, host).dispose

    const root = host.querySelector<HTMLElement>('[data-synchronous-flow]')!
    const switchOutput = host.querySelector<HTMLOutputElement>('[data-switch]')!
    const outputs = [...host.querySelectorAll<HTMLOutputElement>('output')]
    expect(outputs.map((output) => output.textContent)).toEqual([
      'ab',
      '3',
      '111',
      '01234',
      '5',
      '5',
    ])

    const switchCapture = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-mode-b]')!.click(),
    )
    expect(host.querySelector('[data-synchronous-flow]')).toBe(root)
    expect(switchOutput.textContent).toBe('b')
    expect(() =>
      assertMutationEnvelope(
        switchCapture.records,
        [{ type: 'characterData', within: switchOutput }],
        'switch fallthrough update',
      ),
    ).not.toThrow()

    const valueCapture = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-short-values]')!.click(),
    )
    expect(host.querySelector('[data-synchronous-flow]')).toBe(root)
    expect(outputs.every((output) => host.contains(output))).toBe(true)
    expect(outputs.map((output) => output.textContent)).toEqual(['b', '9', '9', '01', '2', '2'])
    expect(() =>
      assertMutationEnvelope(
        valueCapture.records,
        outputs.slice(1).map((output) => ({ type: 'characterData' as const, within: output })),
        'loop region update',
      ),
    ).not.toThrow()

    const noop = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-noop]')!.click(),
    )
    expect(noop.records).toEqual([])
  })
})
