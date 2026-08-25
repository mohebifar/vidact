import { defineClientBoundary } from '@vidact/runtime/framework'
import {
  createEventReplayQueue,
  hydrateClientBoundaries,
  hydrateFrameworkBoundary,
} from '@vidact/runtime/framework/hydrate'
import {
  createClientModuleManifest,
  createClientReference,
} from '@vidact/runtime/framework/protocol'
import { createClientBoundary, renderToReadableStream } from '@vidact/runtime/framework/server'
import { jsx as serverJsx, jsxs as serverJsxs, type ServerChild } from '@vidact/runtime/server'
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

it('loads and hydrates a manifest client boundary while retaining its server nodes', async () => {
  const manifest = createClientModuleManifest({ 'test/Counter': ['counter'] })
  const reference = createClientReference('test/Counter', 'counter')
  const host = document.createElement('div')
  host.innerHTML = await readStream(
    await renderToReadableStream(() =>
      createClientBoundary(
        reference,
        { initialCount: 0 },
        serverJsx(ServerFrameworkBoundary, null),
        { clientManifest: manifest },
      ),
    ),
  )
  document.body.append(host)
  const boundaryHost = host.querySelector<HTMLElement>('[data-vidact-client-boundary]')!
  const section = boundaryHost.querySelector('section')!
  const button = boundaryHost.querySelector<HTMLButtonElement>('[data-increment]')!
  const output = boundaryHost.querySelector<HTMLOutputElement>('[data-count]')!
  const outputText = requireSingleDirectText(output)
  let releaseModule!: () => void
  const moduleReady = new Promise<void>((resolve) => {
    releaseModule = resolve
  })
  const prepared = { offset: 0 }
  let receivedPrepared: typeof prepared | undefined
  const counter = defineClientBoundary(
    (props: { readonly initialCount: number }, value: typeof prepared) => {
      receivedPrepared = value
      return FrameworkHydrationApp({ initialCount: props.initialCount + value.offset })
    },
    async () => prepared,
  )

  const hydration = captureMutations(host, async () => {
    const pending = hydrateClientBoundaries(host, async (loadedReference) => {
      expect(loadedReference).toEqual(reference)
      await moduleReady
      return { counter }
    })
    await Promise.resolve()
    button.click()
    releaseModule()
    return pending
  })
  const capture = await hydration
  const boundaries = capture.result

  expect(boundaryHost.querySelector('section')).toBe(section)
  expect(boundaryHost.querySelector('[data-increment]')).toBe(button)
  expect(output.textContent).toBe('1')
  expect(receivedPrepared).toBe(prepared)
  expect(() =>
    assertMutationEnvelope(
      capture.records,
      [{ type: 'characterData', target: outputText }],
      'manifest client boundary hydration and replay',
    ),
  ).not.toThrow()

  const replacementCounter = defineClientBoundary((props: { readonly initialCount: number }) =>
    FrameworkHydrationApp(props),
  )
  await boundaries.replace(async (loadedReference) => {
    expect(loadedReference).toEqual(reference)
    return { counter: replacementCounter }
  })

  const replacementSection = boundaryHost.querySelector('section')!
  const replacementButton = boundaryHost.querySelector<HTMLButtonElement>('[data-increment]')!
  const replacementOutput = boundaryHost.querySelector<HTMLOutputElement>('[data-count]')!
  expect(host.querySelector('[data-vidact-client-boundary]')).toBe(boundaryHost)
  expect(replacementSection).not.toBe(section)
  expect(replacementOutput.textContent).toBe('0')
  replacementButton.click()
  expect(replacementOutput.textContent).toBe('1')

  boundaries.dispose()
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
