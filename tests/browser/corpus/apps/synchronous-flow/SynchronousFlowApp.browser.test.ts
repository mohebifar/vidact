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
    const flowOutputs = [
      switchOutput,
      host.querySelector<HTMLOutputElement>('[data-for-of]')!,
      host.querySelector<HTMLOutputElement>('[data-for]')!,
      host.querySelector<HTMLOutputElement>('[data-for-in]')!,
      host.querySelector<HTMLOutputElement>('[data-while]')!,
      host.querySelector<HTMLOutputElement>('[data-do-while]')!,
    ]
    expect(flowOutputs.map((output) => output.textContent)).toEqual([
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
    expect(flowOutputs.every((output) => host.contains(output))).toBe(true)
    expect(flowOutputs.map((output) => output.textContent)).toEqual(['b', '9', '9', '01', '2', '2'])
    expect(() =>
      assertMutationEnvelope(
        valueCapture.records,
        flowOutputs.slice(1).map((output) => ({ type: 'characterData' as const, within: output })),
        'loop region update',
      ),
    ).not.toThrow()

    const noop = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-noop]')!.click(),
    )
    expect(noop.records).toEqual([])
  })

  it('keeps try/catch native and publishes only the handled result', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(SynchronousFlowApp, host).dispose

    const output = host.querySelector<HTMLOutputElement>('[data-try-catch]')!
    const mutation = await captureMutations(output, () =>
      host.querySelector<HTMLButtonElement>('[data-catch-error]')!.click(),
    )

    expect(output.textContent).toBe('caught')
    expect(() =>
      assertMutationEnvelope(
        mutation.records,
        [{ type: 'characterData', within: output }],
        'handled try/catch publication',
      ),
    ).not.toThrow()
  })

  it('makes unkeyed map identity explicitly positional', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(SynchronousFlowApp, host).dispose

    const list = host.querySelector<HTMLUListElement>('[data-indexed-list]')!
    const initialRows = [...list.querySelectorAll<HTMLLIElement>('li')]
    const firstInput = initialRows[0]!.querySelector<HTMLInputElement>('input')!
    firstInput.value = 'position-owned value'

    const prepend = await captureMutations(list, () =>
      host.querySelector<HTMLButtonElement>('[data-prepend-row]')!.click(),
    )
    const prependedRows = [...list.querySelectorAll<HTMLLIElement>('li')]

    expect(prependedRows).toHaveLength(3)
    expect(prependedRows[0]).toBe(initialRows[0])
    expect(prependedRows[1]).toBe(initialRows[1])
    expect(prependedRows.map((row) => row.dataset.rowId)).toEqual(['new', 'ada', 'grace'])
    expect(firstInput.value).toBe('position-owned value')
    expect(() =>
      assertMutationEnvelope(
        prepend.records,
        [
          { type: 'attributes', within: list },
          { type: 'characterData', within: list },
          { type: 'childList', target: list },
        ],
        'indexed prepend',
      ),
    ).not.toThrow()

    const beforeReverse = [...list.querySelectorAll<HTMLLIElement>('li')]
    const reverse = await captureMutations(list, () =>
      host.querySelector<HTMLButtonElement>('[data-reverse-rows]')!.click(),
    )
    const reversedRows = [...list.querySelectorAll<HTMLLIElement>('li')]

    expect(reversedRows.every((row, index) => row === beforeReverse[index])).toBe(true)
    expect(reversedRows.map((row) => row.dataset.rowId)).toEqual(['grace', 'ada', 'new'])
    expect(reverse.records.every((record) => record.type !== 'childList')).toBe(true)

    const firstOwner = reversedRows[0]
    const removedLabelTargets = reversedRows
      .slice(1)
      .map((row) => row.querySelector<HTMLElement>('span')!)
    const truncate = await captureMutations(list, () =>
      host.querySelector<HTMLButtonElement>('[data-truncate-rows]')!.click(),
    )

    expect(list.querySelectorAll('li')).toHaveLength(1)
    expect(list.querySelector('li')).toBe(firstOwner)
    expect(() =>
      assertMutationEnvelope(
        truncate.records,
        [
          { type: 'childList', within: list },
          ...removedLabelTargets.map((target) => ({ type: 'childList' as const, target })),
        ],
        'indexed truncate',
      ),
    ).not.toThrow()
  })

  it('lowers keyed for-of JSX accumulation to surgical record owners', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(SynchronousFlowApp, host).dispose

    const list = host.querySelector<HTMLOListElement>('[data-keyed-loop-list]')!
    const ada = list.querySelector<HTMLLIElement>('[data-keyed-row-id="ada"]')!
    const grace = list.querySelector<HTMLLIElement>('[data-keyed-row-id="grace"]')!
    const adaInput = ada.querySelector<HTMLInputElement>('input')!
    adaInput.value = 'key owner state'
    adaInput.focus()

    const prepend = await captureMutations(list, () =>
      host.querySelector<HTMLButtonElement>('[data-prepend-row]')!.click(),
    )

    expect(list.querySelector('[data-keyed-row-id="ada"]')).toBe(ada)
    expect(list.querySelector('[data-keyed-row-id="grace"]')).toBe(grace)
    expect(list.querySelectorAll('li')[0]?.getAttribute('data-keyed-row-id')).toBe('new')
    expect(document.activeElement).toBe(adaInput)
    expect(adaInput.value).toBe('key owner state')
    expect(() =>
      assertMutationEnvelope(
        prepend.records,
        [{ type: 'childList', target: list }],
        'keyed loop prepend',
      ),
    ).not.toThrow()

    const reverse = await captureMutations(list, () =>
      host.querySelector<HTMLButtonElement>('[data-reverse-rows]')!.click(),
    )
    expect(list.querySelectorAll('li')[0]).toBe(grace)
    expect(list.querySelectorAll('li')[1]).toBe(ada)
    expect(document.activeElement).toBe(adaInput)
    expect(() =>
      assertMutationEnvelope(
        reverse.records,
        [{ type: 'childList', target: list }],
        'keyed loop reorder',
      ),
    ).not.toThrow()

    const adaLabel = ada.querySelector<HTMLElement>('span')!
    const update = await captureMutations(list, () =>
      host.querySelector<HTMLButtonElement>('[data-update-row]')!.click(),
    )
    expect(list.querySelector('[data-keyed-row-id="ada"]')).toBe(ada)
    expect(adaLabel.textContent).toBe('ADA')
    expect(() =>
      assertMutationEnvelope(
        update.records,
        [{ type: 'characterData', within: adaLabel }],
        'keyed loop immutable row update',
      ),
    ).not.toThrow()
  })
})
