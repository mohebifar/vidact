import { VIDACT_START_NAVIGATION_HEADER, VIDACT_START_SNAPSHOT_MEDIA_TYPE } from '@vidact/start'
import { describe, expect, it } from 'vitest'

import { loadDocsLayoutRoute } from '../src/lib/docs-loader.ts'
import handler from '../src/server.ts'

describe('Vidact documentation site', () => {
  it('server-renders the Fumadocs-backed overview', async () => {
    const response = await handler(new Request('https://example.test/docs'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('What is Vidact?')
    expect(html).toContain('Experimental software')
    expect(html).toContain('vidact-start-snapshot')
    expect(html).toContain('Build your first Vidact application')
  })

  it('server-renders nested tutorial and reference documents', async () => {
    const response = await handler(
      new Request('https://example.test/docs/reference/react-compatibility'),
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('Status terms')
    expect(html).toContain('Function components and supported custom hooks')
    expect(html).toContain('React compatibility without React interop')
  })

  it('uses the Fumadocs page tree for grouped navigation order', async () => {
    const layout = await loadDocsLayoutRoute()
    const navigation = layout.navigation.flatMap((group) => group.items)

    expect(layout.navigation.map((group) => group.title)).toEqual([
      'Overview',
      'Tutorials',
      'How-to guides',
      'Reference',
      'Explanation',
    ])
    expect(navigation.map((item) => item.url)).toEqual([
      '/docs',
      '/docs/tutorials/first-application',
      '/docs/tutorials/vidact-start',
      '/docs/guides/state-and-effects',
      '/docs/guides/conditional-rendering',
      '/docs/guides/keyed-collections',
      '/docs/guides/forms',
      '/docs/guides/context-and-stores',
      '/docs/guides/routes-and-data',
      '/docs/guides/ssr-and-hydration',
      '/docs/guides/feature-flags',
      '/docs/guides/production',
      '/docs/guides/troubleshooting',
      '/docs/reference/react-compatibility',
      '/docs/reference/vite-plugin',
      '/docs/reference/start',
      '/docs/reference/compiler',
      '/docs/reference/runtime',
      '/docs/explanation/how-compilation-works',
      '/docs/explanation/ownership-and-identity',
      '/docs/explanation/static-reactivity',
      '/docs/explanation/server-and-hydration',
      '/docs/explanation/react-compatibility',
      '/docs/explanation/vidact-start-boundary',
    ])
  })

  it('returns a Start navigation snapshot without the document shell', async () => {
    const response = await handler(
      new Request('https://example.test/docs/tutorials/first-application', {
        headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
      }),
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(VIDACT_START_SNAPSHOT_MEDIA_TYPE)
    expect(body).toContain('Write the component')
    expect(body).toContain('\\"language\\",\\"tsx\\"')
    expect(body).toContain('#85E89D')
    expect(body).not.toContain('<!doctype html>')
  })

  it('returns 404 for an unknown document', async () => {
    const response = await handler(new Request('https://example.test/docs/not-a-page'))

    expect(response.status).toBe(404)
  })
})
