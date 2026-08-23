import { createEventReplayQueue, hydrateFrameworkBoundary } from '@vidact/runtime/framework/hydrate'
import {
  jsx as serverJsx,
  jsxs as serverJsxs,
  renderToReadableStream,
  type ServerChild,
} from '@vidact/runtime/framework/server'
import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { afterEach, expect, it } from 'vitest'

import { FrameworkHydrationApp } from './FrameworkHydrationApp.tsx'

function ServerFrameworkBoundary(): ServerChild {
  return serverJsxs('section', {
    'data-framework-boundary': true,
    children: [
      serverJsx('button', { 'data-increment': true, children: 'increment' }),
      serverJsx('output', { 'data-count': true, children: '0' }),
    ],
  })
}

afterEach(() => {
  document.head
    .querySelectorAll('link[href="https://assets.example.test/"]')
    .forEach((node) => node.remove())
  document.body.replaceChildren()
})

it('hydrates an independent framework boundary and replays queued events surgically', async () => {
  const host = document.createElement('div')
  host.innerHTML = await readStream(
    await renderToReadableStream(() => serverJsx(ServerFrameworkBoundary, null)),
  )
  document.body.append(host)
  const section = host.querySelector('section')!
  const button = host.querySelector<HTMLButtonElement>('[data-increment]')!
  const output = host.querySelector<HTMLOutputElement>('[data-count]')!
  const outputText = requireSingleDirectText(output)
  const replay = createEventReplayQueue(host)

  button.click()
  expect(replay.size()).toBe(1)
  const mutation = await captureMutations(host, () =>
    hydrateFrameworkBoundary(host, FrameworkHydrationApp, { replay }),
  )

  expect(host.querySelector('section')).toBe(section)
  expect(host.querySelector('[data-increment]')).toBe(button)
  expect(output.textContent).toBe('1')
  expect(document.head.querySelectorAll('link[rel="preconnect"]')).toHaveLength(1)
  expect(() =>
    assertMutationEnvelope(
      mutation.records,
      [{ type: 'characterData', target: outputText }],
      'framework event replay',
    ),
  ).not.toThrow()
})

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- A stream reader is inherently sequential.
    const result = await reader.read()
    if (result.done) return output
    output += decoder.decode(result.value, { stream: true })
  }
}
