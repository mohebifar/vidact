import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { ShadcnExpansionProof } from './ShadcnExpansionProof.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('expanded shadcn Base UI compatibility', () => {
  it('mounts Avatar and opens an uncontrolled Collapsible', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    dispose = mountCompiled(
      ShadcnExpansionProof as unknown as () => CompiledComponentResult,
      host,
    ).dispose
    await Promise.resolve()

    const proof = host.querySelector<HTMLElement>('[data-testid="expansion-proof"]')!
    const avatar = host.querySelector<HTMLElement>('[data-testid="proof-avatar"]')!
    const collapsible = host.querySelector<HTMLElement>('[data-testid="proof-collapsible"]')!
    const trigger = collapsible.querySelector<HTMLButtonElement>('button')!

    expect(avatar.textContent).toContain('VD')
    expect(host.querySelector('[data-testid="proof-content"]')).toBeNull()

    const opened = await captureMutations(host, () => trigger.click())

    const currentCollapsible = host.querySelector<HTMLElement>('[data-testid="proof-collapsible"]')!
    const currentTrigger = currentCollapsible.querySelector<HTMLButtonElement>('button')!
    expect(currentTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('[data-testid="proof-content"]')?.textContent).toContain(
      'Compiled through Base UI',
    )
    expect(host.querySelector('[data-testid="expansion-proof"]')).toBe(proof)
    expect(host.querySelector('[data-testid="proof-avatar"]')).toBe(avatar)
    expect(opened.records.length).toBeGreaterThan(0)
  })

  it('updates Collapsible without replacing its stable DOM owners', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    dispose = mountCompiled(
      ShadcnExpansionProof as unknown as () => CompiledComponentResult,
      host,
    ).dispose
    await Promise.resolve()

    const collapsible = host.querySelector<HTMLElement>('[data-testid="proof-collapsible"]')!
    const trigger = collapsible.querySelector<HTMLButtonElement>('button')!
    const opened = await captureMutations(host, () => trigger.click())

    expect(() =>
      assertMutationEnvelope(
        opened.records,
        [
          { type: 'attributes', within: collapsible },
          { type: 'childList', within: collapsible },
        ],
        'collapsible open',
      ),
    ).not.toThrow()
    expect(host.querySelector('[data-testid="proof-collapsible"]')).toBe(collapsible)
    expect(collapsible.querySelector('button')).toBe(trigger)
  })
})
