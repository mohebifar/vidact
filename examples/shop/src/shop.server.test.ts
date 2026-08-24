import { describe, expect, it } from 'vitest'

import { handleApiRequest } from './backend.ts'
import { CATALOG } from './catalog.ts'
import { renderShopPage } from './server.ts'

describe('shop server', () => {
  it('renders a fulfilled async catalog with hydration data and client assets', async () => {
    const html = await renderShopPage(CATALOG.slice(0, 2))

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Ridge Bottle')
    expect(html).toContain('Weekender Tote')
    expect(html).toContain('vidact:v1')
    expect(html).toContain('id="shop-data"')
    expect(html).toContain('src="/assets/client.js"')
    expect(html).not.toContain('Updating the collection')
  })

  it('filters products and validates mock checkout requests', async () => {
    const productsResponse = await handleApiRequest(
      new Request('http://shop.test/api/products?category=travel'),
    )
    expect(productsResponse?.status).toBe(200)
    const productsPayload = (await productsResponse?.json()) as {
      readonly products: readonly { readonly category: string }[]
    }
    expect(productsPayload.products).toHaveLength(2)
    expect(productsPayload.products.every((product) => product.category === 'travel')).toBe(true)

    const emptyCheckout = await handleApiRequest(
      new Request('http://shop.test/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      }),
    )
    expect(emptyCheckout?.status).toBe(400)

    const checkout = await handleApiRequest(
      new Request('http://shop.test/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ productId: 'ridge-bottle', quantity: 2 }] }),
      }),
    )
    expect(checkout?.status).toBe(201)
    const receipt = (await checkout?.json()) as {
      readonly itemCount: number
      readonly totalCents: number
    }
    expect(receipt.itemCount).toBe(2)
    expect(receipt.totalCents).toBe(6800)
  })
})
