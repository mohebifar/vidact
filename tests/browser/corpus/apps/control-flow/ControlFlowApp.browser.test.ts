import { mountCompiled } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ControlFlowApp,
  KeyedControlFlowApp,
  LogicalFlowApp,
  SwitchFlowApp,
} from './ControlFlowApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled render control flow', () => {
  it('preserves aligned identity and replaces only a divergent owned range', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(ControlFlowApp, host).dispose

    const shell = host.querySelector<HTMLElement>('[data-shell]')!
    const counter = host.querySelector<HTMLElement>('[data-counter]')!
    const increment = host.querySelector<HTMLButtonElement>('[data-counter-increment]')!
    const input = host.querySelector<HTMLInputElement>('[data-counter-input]')!
    const row = host.querySelector<HTMLLIElement>('[data-counter-row]')!
    const list = row.parentElement!
    const toggle = host.querySelector<HTMLButtonElement>('[data-toggle]')!
    const showOther = host.querySelector<HTMLButtonElement>('[data-show-other]')!
    increment.click()
    input.focus()
    expect(increment.textContent).toBe('first:1')

    const counterLabelText = [...increment.childNodes].find(
      (node): node is Text => node instanceof Text && node.data === 'first',
    )!
    const alignedCapture = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle]')!.click(),
    )

    expect(host.querySelector('[data-shell]')).toBe(shell)
    expect(host.querySelector('[data-counter]')).toBe(counter)
    expect(host.querySelector('[data-counter-input]')).toBe(input)
    expect(host.querySelector('[data-counter-row]')).toBe(row)
    expect(document.activeElement).toBe(input)
    expect(increment.textContent).toBe('second:1')
    expect(shell.dataset.mode).toBe('second')
    expect(shell.hasAttribute('aria-label')).toBe(false)
    expect(() =>
      assertMutationEnvelope(
        alignedCapture.records,
        [
          { type: 'attributes', target: shell, attributeName: 'data-mode' },
          { type: 'attributes', target: counter, attributeName: 'data-label' },
          { type: 'attributes', target: shell, attributeName: 'aria-label' },
          { type: 'characterData', target: counterLabelText },
        ],
        'aligned render alternative',
      ),
    ).not.toThrow()

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-toggle]')!.click(),
    )
    expect(host.querySelector('[data-shell]')).toBe(shell)
    expect(host.querySelector('[data-counter]')).toBe(counter)
    expect(host.querySelector('[data-counter-input]')).toBe(input)
    expect(host.querySelector('[data-counter-row]')).toBe(row)
    expect(document.activeElement).toBe(input)
    expect(increment.textContent).toBe('first:1')
    expect(shell.getAttribute('aria-label')).toBe('first mode')

    const divergentCapture = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-show-other]')!.click(),
    )
    expect(host.querySelector('[data-other]')).not.toBeNull()
    expect(host.querySelector('[data-shell]')).toBeNull()
    expect(() =>
      assertMutationEnvelope(
        divergentCapture.records,
        [
          { type: 'childList', within: shell },
          { type: 'childList', target: counter },
          { type: 'childList', target: list },
          { type: 'childList', target: row },
          { type: 'childList', target: increment },
          { type: 'childList', target: toggle },
          { type: 'childList', target: showOther },
          { type: 'childList', target: host },
        ],
        'divergent render alternative',
      ),
    ).not.toThrow()

    const disposedBranch = await captureMutations(host, () => {
      increment.click()
      showOther.click()
    })
    expect(disposedBranch.records).toEqual([])
    expect(host.querySelector('[data-other]')).not.toBeNull()

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-return]')!.click(),
    )
    expect(host.querySelector('[data-shell]')).not.toBe(shell)
    expect(host.querySelector('[data-counter]')).not.toBe(counter)
    expect(host.querySelector('[data-counter-increment]')?.textContent).toBe('first:0')
  })

  it('preserves JavaScript values for and, or, and nullish selections', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(LogicalFlowApp, host).dispose

    const root = host.querySelector<HTMLElement>('[data-logical-flow]')!
    const andOutput = host.querySelector<HTMLOutputElement>('[data-and]')!
    const orOutput = host.querySelector<HTMLOutputElement>('[data-or]')!
    const nullishOutput = host.querySelector<HTMLOutputElement>('[data-nullish]')!
    const initialTexts = [...host.querySelectorAll('output')].flatMap((output) =>
      [...output.childNodes].filter((node): node is Text => node instanceof Text),
    )

    expect(andOutput.textContent).toBe('0')
    expect(orOutput.textContent).toBe('or')
    expect(nullishOutput.textContent).toBe('0')

    const noop = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-noop]')!.click(),
    )
    expect(noop.records).toEqual([])

    const two = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-two]')!.click(),
    )
    expect(host.querySelector('[data-logical-flow]')).toBe(root)
    expect(host.querySelector('[data-and]')).toBe(andOutput)
    expect(host.querySelector('[data-or]')).toBe(orOutput)
    expect(host.querySelector('[data-nullish]')).toBe(nullishOutput)
    expect(andOutput.textContent).toBe('and')
    expect(orOutput.textContent).toBe('2')
    expect(nullishOutput.textContent).toBe('2')
    expect(() =>
      assertMutationEnvelope(
        two.records,
        [
          { type: 'childList', target: andOutput },
          { type: 'childList', target: orOutput },
          { type: 'childList', target: nullishOutput },
          { type: 'characterData', within: andOutput },
          { type: 'characterData', within: orOutput },
          { type: 'characterData', within: nullishOutput },
          ...initialTexts.map((target) => ({ type: 'characterData' as const, target })),
        ],
        'logical value selection',
      ),
    ).not.toThrow()

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-null]')!.click(),
    )
    expect(andOutput.textContent).toBe('')
    expect(orOutput.textContent).toBe('or')
    expect(nullishOutput.textContent).toBe('nullish')
  })

  it('remounts a component when its static key changes', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(KeyedControlFlowApp, host).dispose

    const counter = host.querySelector<HTMLElement>('[data-keyed-counter]')!
    host.querySelector<HTMLButtonElement>('[data-keyed-increment]')!.click()
    expect(host.querySelector('[data-keyed-count]')?.textContent).toBe('1')

    const capture = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-keyed-swap]')!.click(),
    )
    expect(host.querySelector('[data-keyed-counter]')).not.toBe(counter)
    expect(host.querySelector('[data-keyed-count]')?.textContent).toBe('0')
    expect(() =>
      assertMutationEnvelope(
        capture.records,
        [
          { type: 'childList', within: counter },
          { type: 'childList', target: host },
        ],
        'changed component key',
      ),
    ).not.toThrow()

    const secondCounter = host.querySelector<HTMLElement>('[data-keyed-counter]')!
    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-keyed-swap]')!.click(),
    )
    expect(host.querySelector('[data-keyed-counter]')).not.toBe(secondCounter)
    expect(host.querySelector('[data-keyed-count]')?.textContent).toBe('0')
  })

  it('executes terminal switch branches through one owned range repeatedly', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(SwitchFlowApp, host).dispose

    const first = host.querySelector<HTMLElement>('[data-switch-a]')!
    const forward = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-switch-next]')!.click(),
    )
    const second = host.querySelector<HTMLElement>('[data-switch-b]')!
    expect(second).not.toBe(first)
    expect(() =>
      assertMutationEnvelope(
        forward.records,
        [
          { type: 'childList', within: first },
          { type: 'childList', target: host },
        ],
        'terminal switch forward',
      ),
    ).not.toThrow()

    await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-switch-next]')!.click(),
    )
    expect(host.querySelector('[data-switch-a]')).not.toBe(first)
    expect(host.querySelector('[data-switch-b]')).toBeNull()
  })
})
