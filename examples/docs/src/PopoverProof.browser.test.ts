import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { PopoverProof } from './PopoverProof.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('Vidact-native shadcn Popover', () => {
  it('opens and closes surgically while retaining the trigger owner', async () => {
    const host = mountProof()
    const shell = host.querySelector<HTMLElement>('[data-testid="popover-proof"]')!
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="uncontrolled-trigger"]')!

    const opened = await captureMutations(document.body, () => trigger.click())
    const content = document.querySelector<HTMLElement>('[data-testid="uncontrolled-content"]')!
    const positioner = content.parentElement!
    const title = content.querySelector<HTMLElement>('[data-slot="popover-title"]')!
    const description = content.querySelector<HTMLElement>('[data-slot="popover-description"]')!
    const nestedTrigger = content.querySelector<HTMLButtonElement>(
      '[data-testid="nested-trigger"]',
    )!

    expect(content).not.toBeNull()
    expect(content.getAttribute('role')).toBe('dialog')
    expect(content.getAttribute('aria-labelledby')).toBe(title.id)
    expect(content.getAttribute('aria-describedby')).toBe(description.id)
    expect(document.activeElement).toBe(content.querySelector('[data-testid="inside-action"]'))
    expect(host.querySelector('[data-testid="popover-proof"]')).toBe(shell)
    expect(host.querySelector('[data-testid="uncontrolled-trigger"]')).toBe(trigger)
    expect(() =>
      assertMutationEnvelope(
        opened.records,
        [
          { type: 'attributes', target: trigger },
          { type: 'childList', target: document.body },
          { type: 'childList', within: shell },
          { type: 'characterData', within: shell },
          { type: 'attributes', within: content },
          { type: 'attributes', within: positioner },
        ],
        'popover open',
      ),
    ).not.toThrow()

    const closed = await captureMutations(document.body, () => trigger.click())
    await Promise.resolve()

    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(host.querySelector('[data-testid="uncontrolled-trigger"]')).toBe(trigger)
    expect(host.querySelector('[data-testid="uncontrolled-changes"]')?.textContent).toBe('2')
    expect(() =>
      assertMutationEnvelope(
        closed.records,
        [
          { type: 'attributes', target: trigger },
          { type: 'childList', target: document.body },
          { type: 'childList', within: content },
          { type: 'childList', within: title },
          { type: 'childList', within: description },
          { type: 'childList', target: nestedTrigger },
          { type: 'childList', within: shell },
          { type: 'characterData', within: shell },
        ],
        'popover close',
      ),
    ).not.toThrow()
  })

  it('dismisses by Escape and outside pointer with reason-aware focus', async () => {
    const host = mountProof()
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="uncontrolled-trigger"]')!
    const outside = host.querySelector<HTMLButtonElement>('[data-testid="outside-target"]')!

    trigger.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await Promise.resolve()
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    trigger.click()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    outside.focus()
    await Promise.resolve()
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('dismisses only the topmost logical layer for nested portals', async () => {
    const host = mountProof()
    const outerTrigger = host.querySelector<HTMLButtonElement>(
      '[data-testid="uncontrolled-trigger"]',
    )!
    const outside = host.querySelector<HTMLButtonElement>('[data-testid="outside-target"]')!

    outerTrigger.click()
    const outerContent = document.querySelector<HTMLElement>(
      '[data-testid="uncontrolled-content"]',
    )!
    const nestedTrigger = outerContent.querySelector<HTMLButtonElement>(
      '[data-testid="nested-trigger"]',
    )!
    nestedTrigger.click()
    const nestedContent = document.querySelector<HTMLElement>('[data-testid="nested-content"]')!
    const nestedAction = nestedContent.querySelector<HTMLButtonElement>(
      '[data-testid="nested-action"]',
    )!

    nestedAction.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector('[data-testid="nested-content"]')).toBe(nestedContent)
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBe(outerContent)

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await Promise.resolve()
    expect(document.querySelector('[data-testid="nested-content"]')).toBeNull()
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBe(outerContent)
    expect(document.activeElement).toBe(nestedTrigger)

    nestedTrigger.click()
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    outside.focus()
    await Promise.resolve()
    expect(document.querySelector('[data-testid="nested-content"]')).toBeNull()
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBe(outerContent)
    expect(document.activeElement).toBe(outside)

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await Promise.resolve()
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBeNull()
  })

  it('keeps controlled interactions as requests until the parent publishes', async () => {
    const host = mountProof()
    const shell = host.querySelector<HTMLElement>('[data-testid="popover-proof"]')!
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="controlled-trigger"]')!
    const publish = host.querySelector<HTMLButtonElement>('[data-testid="publish-controlled"]')!

    trigger.click()
    expect(document.querySelector('[data-testid="controlled-content"]')).toBeNull()
    expect(host.querySelector('[data-testid="controlled-requests"]')?.textContent).toBe('1')

    publish.click()
    await Promise.resolve()
    expect(document.querySelector('[data-testid="controlled-content"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="popover-proof"]')).toBe(shell)
    expect(host.querySelector('[data-testid="controlled-trigger"]')).toBe(trigger)

    trigger.click()
    expect(document.querySelector('[data-testid="controlled-content"]')).not.toBeNull()
    publish.focus()
    publish.click()
    await Promise.resolve()
    expect(document.querySelector('[data-testid="controlled-content"]')).toBeNull()
    expect(document.activeElement).toBe(publish)
  })

  it('removes portal content and document behavior when the owner is disposed', async () => {
    const host = mountProof()
    host.querySelector<HTMLButtonElement>('[data-testid="uncontrolled-trigger"]')!.click()
    expect(document.querySelector('[data-testid="uncontrolled-content"]')).not.toBeNull()

    dispose?.()
    dispose = undefined
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await Promise.resolve()

    expect(document.querySelector('[data-testid="uncontrolled-content"]')).toBeNull()
  })
})

function mountProof(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = mountCompiled(PopoverProof as unknown as () => CompiledComponentResult, host).dispose
  return host
}
