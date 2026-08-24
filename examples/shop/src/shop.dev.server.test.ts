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
    const productsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/products?category=travel`,
    )
    const products = (await productsResponse.json()) as {
      readonly products: readonly { readonly category: string }[]
    }
    const checkoutResponse = await fetch(`http://127.0.0.1:${address.port}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: 'ridge-bottle', quantity: 2 }] }),
    })
    const receipt = (await checkoutResponse.json()) as {
      readonly itemCount: number
      readonly totalCents: number
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(html).toContain('Ridge Bottle')
    expect(html).toContain('vidact:v1')
    expect(html).toContain('/@vite/client')
    expect(html).toContain('src="/src/client.ts"')
    expect(clientResponse.status).toBe(200)
    expect(clientModule?.isSelfAccepting).toBe(true)
    expect(productsResponse.status).toBe(200)
    expect(products.products).toHaveLength(2)
    expect(products.products.every((product) => product.category === 'travel')).toBe(true)
    expect(checkoutResponse.status).toBe(201)
    expect(receipt).toMatchObject({ itemCount: 2, totalCents: 6800 })
  })
})
