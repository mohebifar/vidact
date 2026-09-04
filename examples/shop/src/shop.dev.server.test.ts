import { fileURLToPath } from 'node:url'

import { createServer, type ViteDevServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

let server: ViteDevServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('shop development server', () => {
  it('serves SSR through Vite with the client runtime and HMR installed', async () => {
    const projectRoot = fileURLToPath(new URL('..', import.meta.url))
    const configFile = fileURLToPath(new URL('../vite.dev.config.ts', import.meta.url))
    server = await createServer({
      root: projectRoot,
      configFile,
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite did not expose a TCP development address.')
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/`)
    const html = await response.text()
    const clientResponse = await fetch(`http://127.0.0.1:${address.port}/src/client.ts`)
    await clientResponse.text()
    const clientModule =
      await server.environments.client.moduleGraph.getModuleByUrl('/src/client.ts')
    const clientBoundaryModule = await server.environments.client.moduleGraph.getModuleByUrl(
      '/src/ShopClient.client.ts',
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(html).toContain('Ridge Bottle')
    expect(html).toContain('<!--v2:r-->')
    expect(html).toContain('/@vite/client')
    expect(html).toContain('src="/src/client.ts"')
    expect(clientResponse.status).toBe(200)
    expect(clientModule?.acceptedHmrDeps.has(clientBoundaryModule!)).toBe(true)
  })
})
