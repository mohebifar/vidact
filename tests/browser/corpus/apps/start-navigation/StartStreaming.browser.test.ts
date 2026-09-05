import { compiledRoot, createCompiledScope, h, type CompiledRenderValue } from '@vidact/runtime'
import {
  createElement as createServerElement,
  Suspense,
  use,
  type ServerChild,
} from '@vidact/runtime/server'
import { captureMutations } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import { hydrateStart } from '../../../../../packages/start/src/client.ts'
import { createRouteManifest, defineFileRoute } from '../../../../../packages/start/src/router.ts'
import { createStartHandler } from '../../../../../packages/start/src/server.ts'

let serverTarget = true
let message: Promise<string>

const manifest = createRouteManifest([
  {
    id: 'index',
    parentId: null,
    path: '/',
    load: async () => ({
      Route: defineFileRoute({
        component: (serverTarget ? ServerPage : ClientPage) as never,
      }),
    }),
  },
])

describe('Start document streaming hydration', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('hydrates the marker-complete application delivered after the early shell', async () => {
    let resolve!: (value: string) => void
    message = new Promise<string>((resolvePromise) => {
      resolve = resolvePromise
    })
    serverTarget = true
    window.history.replaceState({}, '', '/')
    const response = await createStartHandler({ manifest })(new Request(window.location.href))
    const reader = response.body!.getReader()

    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('<div id="vidact-start-root">')
    expect(first).not.toContain('streamed-message')

    resolve('ready')
    const html = first + (await readReader(reader))
    expect(html.indexOf('streamed-message')).toBeLessThan(html.indexOf('vidact-start-snapshot'))
    const page = new DOMParser().parseFromString(html, 'text/html')
    document.body.innerHTML = page.body.innerHTML
    const host = document.querySelector('#vidact-start-root')!
    const serverMessage = host.querySelector('#streamed-message')!
    serverTarget = false

    const hydration = await captureMutations(host, () =>
      hydrateStart({
        manifest,
        onRecoverableError(error) {
          throw error
        },
        root: host,
        snapshot: document.querySelector('#vidact-start-snapshot')!.textContent ?? '',
      }),
    )

    expect(hydration.records).toHaveLength(0)
    expect(host.querySelector('#streamed-message')).toBe(serverMessage)
    expect(serverMessage.textContent).toBe('ready')
    hydration.result.unmount()
  })
})

function ServerPage(): ServerChild {
  return Suspense({
    children: () =>
      createServerElement(
        'main',
        { id: 'streamed-app' },
        createServerElement('strong', { id: 'streamed-message' }, use(message)),
      ),
    fallback: () => createServerElement('p', null, 'loading'),
  })
}

function ClientPage(): CompiledRenderValue {
  const scope = createCompiledScope()
  return compiledRoot(scope, () =>
    h('main', { id: 'streamed-app' }, h('strong', { id: 'streamed-message' }, 'ready')),
  )
}

async function readReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- A stream reader is inherently sequential.
    const result = await reader.read()
    if (result.done) return text + decoder.decode()
    text += decoder.decode(result.value, { stream: true })
  }
}
