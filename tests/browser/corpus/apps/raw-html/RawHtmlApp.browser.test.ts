import { mountCompiled } from '@vidact/runtime'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { RawHtmlApp } from './RawHtmlApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('compiled raw HTML app', () => {
  it('replaces only the opaque subtree and skips equivalent payloads', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = mountCompiled(RawHtmlApp, host).dispose

    const app = host.querySelector<HTMLElement>('[data-raw-html-app]')!
    const raw = host.querySelector<HTMLElement>('[data-raw-container]')!
    const unaffected = host.querySelector<HTMLElement>('[data-unaffected]')!
    const originalRawChild = raw.firstElementChild

    const equivalent = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-same]')!.click(),
    )

    expect(equivalent.records).toEqual([])
    expect(raw.firstElementChild).toBe(originalRawChild)

    const replacement = await captureMutations(host, () =>
      host.querySelector<HTMLButtonElement>('[data-two]')!.click(),
    )

    expect(host.querySelector('[data-raw-html-app]')).toBe(app)
    expect(host.querySelector('[data-raw-container]')).toBe(raw)
    expect(host.querySelector('[data-unaffected]')).toBe(unaffected)
    expect(raw.querySelector('[data-version="two"]')?.textContent).toBe('Two')
    expect(raw.firstElementChild).not.toBe(originalRawChild)
    expect(() =>
      assertMutationEnvelope(
        replacement.records,
        [{ type: 'childList', target: raw }],
        'raw HTML replacement',
      ),
    ).not.toThrow()
  })
})
