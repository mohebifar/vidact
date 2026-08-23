import { mountCompiled } from '@vidact/runtime'
import { act } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import ErrorBoundaryApp, { readCaughtErrors, resetCaughtErrors } from './ErrorBoundaryApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  resetCaughtErrors()
  document.body.replaceChildren()
})

describe('compiled function error boundaries', () => {
  it('recovers render, event, and passive effect failures without partial publication', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(() => {
      dispose = mountCompiled(ErrorBoundaryApp, host).dispose
    })

    host.querySelector<HTMLButtonElement>('[data-render]')!.click()
    expect(host.querySelector('[data-fallback] output')?.textContent).toBe('render failed')
    host.querySelector<HTMLButtonElement>('[data-reset]')!.click()
    expect(host.querySelector('[data-child]')?.textContent).toBe('ready')

    host.querySelector<HTMLButtonElement>('[data-event]')!.click()
    host.querySelector<HTMLButtonElement>('[data-child]')!.click()
    expect(host.querySelector('[data-fallback] output')?.textContent).toBe('event failed')
    host.querySelector<HTMLButtonElement>('[data-reset]')!.click()

    await act(() => host.querySelector<HTMLButtonElement>('[data-effect]')!.click())
    expect(host.querySelector('[data-fallback] output')?.textContent).toBe('effect failed')
    expect(readCaughtErrors()).toEqual(['render failed', 'event failed', 'effect failed'])
  })
})
