import { mountCompiled } from '@vidact/runtime'
import { readCompiledOwnerMetrics } from '@vidact/runtime/testing'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { BaseUiDependencyApp } from './BaseUiDependencyApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled Base UI dependency app', () => {
  it('runs published merge logic while retaining the dependency-owned nodes', async () => {
    const baseline = readCompiledOwnerMetrics()
    const host = document.createElement('div')
    document.body.append(host)
    const mounted = mountCompiled(BaseUiDependencyApp, host)
    dispose = mounted.dispose

    const button = host.querySelector<HTMLButtonElement>('[data-base-counter]')!
    const link = host.querySelector<HTMLAnchorElement>('[data-base-link]')!
    const text = [...button.childNodes].findLast((node): node is Text => node instanceof Text)!

    expect(button.type).toBe('button')
    expect(button.className).toBe('counter')
    expect(link.getAttribute('role')).toBe('button')
    expect(link.textContent).toBe('Details')

    const updated = await captureMutations(host, () => button.click())

    expect(host.querySelector('[data-base-counter]')).toBe(button)
    expect(host.querySelector('[data-base-link]')).toBe(link)
    expect(button.className).toBe('counter')
    expect(button.textContent).toBe('Count 1')
    expect(() =>
      assertMutationEnvelope(
        updated.records,
        [{ type: 'characterData', target: text }],
        'Base UI counter update',
      ),
    ).not.toThrow()

    mounted.dispose()
    dispose = undefined
    expect(readCompiledOwnerMetrics().active).toBe(baseline.active)
  })
})
