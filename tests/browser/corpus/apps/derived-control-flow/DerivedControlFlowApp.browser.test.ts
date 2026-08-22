import { mountCompiled } from '@vidact/runtime'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { DerivedControlFlowApp, DerivedTypeFlowApp } from './DerivedControlFlowApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled phi-derived values', () => {
  it('updates the active object and keyed array without touching inactive inputs', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(DerivedControlFlowApp, host).dispose

    const root = host.querySelector<HTMLElement>('[data-derived-flow]')!
    const output = host.querySelector<HTMLOutputElement>('[data-selected]')!
    const outputText = requireSingleDirectText(output)
    const row = host.querySelector<HTMLLIElement>('[data-derived-row]')!
    const rowText = requireSingleDirectText(row)

    expect(root.title).toBe('first')
    expect(output.textContent).toBe('first')
    expect(row.textContent).toBe('first row')

    const inactive = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-update-second]')!.click(),
    )
    expect(inactive.records).toEqual([])
    expect(host.querySelector('[data-derived-row]')).toBe(row)

    const toggle = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle]')!.click(),
    )
    expect(host.querySelector('[data-derived-flow]')).toBe(root)
    expect(host.querySelector('[data-selected]')).toBe(output)
    expect(host.querySelector('[data-derived-row]')).toBe(row)
    expect(root.title).toBe('second!')
    expect(output.textContent).toBe('second!')
    expect(row.textContent).toBe('second row!')
    expect(() =>
      assertMutationEnvelope(
        toggle.records,
        [
          { type: 'attributes', target: root, attributeName: 'title' },
          { type: 'characterData', target: outputText },
          { type: 'characterData', target: rowText },
        ],
        'phi selection change',
      ),
    ).not.toThrow()

    const active = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-update-second]')!.click(),
    )
    expect(host.querySelector('[data-derived-row]')).toBe(row)
    expect(root.title).toBe('second!!')
    expect(output.textContent).toBe('second!!')
    expect(row.textContent).toBe('second row!!')
    expect(() =>
      assertMutationEnvelope(
        active.records,
        [
          { type: 'attributes', target: root, attributeName: 'title' },
          { type: 'characterData', target: outputText },
          { type: 'characterData', target: rowText },
        ],
        'active phi input',
      ),
    ).not.toThrow()

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle]')!.click(),
    )
    expect(host.querySelector('[data-derived-row]')).toBe(row)
    expect(output.textContent).toBe('first')

    const noop = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-noop]')!.click(),
    )
    expect(noop.records).toEqual([])

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-batch]')!.click(),
    )
    expect(host.querySelector('[data-derived-row]')).toBe(row)
    expect(output.textContent).toBe('batched')
    expect(row.textContent).toBe('batched row')
  })

  it('dispatches a phi-derived component type and resets its local state', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(DerivedTypeFlowApp, host).dispose

    const first = host.querySelector<HTMLElement>('[data-first-type]')!
    const firstIncrement = host.querySelector<HTMLButtonElement>('[data-type-increment]')!
    firstIncrement.click()
    expect(firstIncrement.textContent).toBe('first:1')

    const forward = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-type-toggle]')!.click(),
    )
    const second = host.querySelector<HTMLElement>('[data-second-type]')!
    expect(second).not.toBe(first)
    expect(host.querySelector('[data-type-increment]')?.textContent).toBe('second:0')
    expect(() =>
      assertMutationEnvelope(
        forward.records,
        [
          { type: 'childList', within: first },
          { type: 'childList', target: firstIncrement },
          { type: 'childList', target: host },
        ],
        'phi-derived component type',
      ),
    ).not.toThrow()

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-type-toggle]')!.click(),
    )
    const nextFirst = host.querySelector<HTMLElement>('[data-first-type]')!
    expect(nextFirst).not.toBe(first)
    expect(host.querySelector('[data-type-increment]')?.textContent).toBe('first:0')
  })
})
