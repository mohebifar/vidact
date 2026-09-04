import { VIDACT_START_NAVIGATION_HEADER, VIDACT_START_SNAPSHOT_MEDIA_TYPE } from '@vidact/start'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadDocsLayoutRoute } from '../src/lib/docs-loader.ts'
import handler from '../src/server.ts'

describe('Vidact documentation site', () => {
  beforeAll(async () => {
    await loadDocsLayoutRoute()
  }, 30_000)

  it('server-renders the Fumadocs-backed overview', async () => {
    const response = await handler(new Request('https://example.test/docs'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('Why Vidact?')
    expect(html).toContain('Vidact is in beta')
    expect(html).toContain('vidact-start-snapshot')
    expect(html).toContain('Quick start')
  })

  it('server-renders nested tutorial and reference documents', async () => {
    const response = await handler(
      new Request('https://example.test/docs/reference/react-compatibility'),
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('How to read the tables')
    expect(html).toContain('Third-party packages')
    expect(html).toContain('useSyncExternalStore')
  })

  it('returns a Start navigation snapshot without the document shell', async () => {
    const response = await handler(
      new Request('https://example.test/docs/getting-started/quick-start', {
        headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
      }),
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(VIDACT_START_SNAPSHOT_MEDIA_TYPE)
    expect(body).toContain('Write a component')
    expect(body).not.toContain('<!doctype html>')
  })

  it('returns 404 for an unknown document', async () => {
    const response = await handler(new Request('https://example.test/docs/not-a-page'))

    expect(response.status).toBe(404)
  })
})
