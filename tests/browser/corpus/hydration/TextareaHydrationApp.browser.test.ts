import { hydrateRoot } from '@vidact/runtime/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToString,
  useState,
  type ServerChild,
  type ServerComponent,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { TextareaHydrationApp } from './TextareaHydrationApp.tsx'

/**
 * The runtime's component types take an untyped props record, so a component written with
 * typed props needs a cast at the call site. The framework does the same internally.
 */

/** Mirrors the compiled app one component deep, so the component ranges line up. */
function ServerTextareaApp({ initialDraft }: { readonly initialDraft: string }): ServerChild {
  const [bumps] = useState(0)
  return serverJsxs('form', {
    children: [
      serverJsx('textarea', { 'aria-label': 'Draft', readOnly: true, children: initialDraft }),
      serverJsx('button', { type: 'button', children: 'Bump' }),
      serverJsx('output', { children: bumps }),
    ],
  })
}

afterEach(() => document.body.replaceChildren())

it('hydrates textarea contents without markers leaking into the visible value', async () => {
  const host = document.createElement('div')
  const serverMarkup = renderToString(() =>
    serverJsx(ServerTextareaApp as ServerComponent, { initialDraft: 'draft' }),
  )
  // The parser would show any marker inside the textarea as literal text.
  expect(serverMarkup).toContain('<textarea aria-label="Draft" readOnly="">draft</textarea>')

  host.innerHTML = serverMarkup
  document.body.append(host)
  const textarea = host.querySelector('textarea')!
  const output = host.querySelector('output')!
  expect(textarea.value).toBe('draft')
  const recoveries: unknown[] = []

  const hydration = await captureMutations(host, () =>
    hydrateRoot(host, () => TextareaHydrationApp({ initialDraft: 'draft' }), {
      onRecoverableError: (error) => recoveries.push(error),
    }),
  )

  expect(recoveries.map(String)).toEqual([])
  expect(host.querySelector('textarea')).toBe(textarea)
  expect(textarea.value).toBe('draft')
  // The only DOM work is the anchor pair the draft binding creates around the parsed
  // text, since a raw-text element carries no slot markers for it to borrow. Comments
  // inside a textarea do not contribute to its value.
  for (const record of hydration.records) {
    expect(record.type).toBe('childList')
    expect(record.target).toBe(textarea)
  }
  expect([...textarea.childNodes].filter((node) => node instanceof Comment)).toHaveLength(2)

  host.querySelector('button')!.click()
  expect(output.textContent).toBe('1')
  expect(textarea.value).toBe('draft')

  hydration.result.unmount()
})
