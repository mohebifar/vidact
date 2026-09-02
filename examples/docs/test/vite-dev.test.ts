import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url))

let viteServer: ViteDevServer | undefined

afterEach(async () => {
  await viteServer?.close()
  viteServer = undefined
})

describe('docs Vite development server', () => {
  it('server-renders MDX routes without evaluating CommonJS dependencies as ESM', async () => {
    viteServer = await createViteServer({
      root,
      configFile,
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
      },
    })
    await viteServer.listen()

    const address = viteServer.httpServer!.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${address.port}/docs`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('Why Vidact?')
  }, 30_000)
})
