import { describe, expect, it } from 'vitest'

import handler from '../src/server.ts'

describe('Vidact Start example', () => {
  it('server renders a file route', async () => {
    const response = await handler(new Request('https://example.test/products/compiler'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('compiler')
    expect(html).toContain('vidact-start-snapshot')
  })

  it('dispatches a route endpoint', async () => {
    const response = await handler(new Request('https://example.test/api/time'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ now: expect.any(String) })
  })
})
