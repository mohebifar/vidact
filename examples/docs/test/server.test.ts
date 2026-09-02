import { VIDACT_START_NAVIGATION_HEADER, VIDACT_START_SNAPSHOT_MEDIA_TYPE } from '@vidact/start'
import { describe, expect, it } from 'vitest'

import { loadDocsLayoutRoute } from '../src/lib/docs-loader.ts'
import handler from '../src/server.ts'

describe('Vidact documentation site', () => {
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

  it('uses the Fumadocs page tree for grouped navigation order', async () => {
    const layout = await loadDocsLayoutRoute()
    const navigation = layout.navigation.flatMap((group) => group.items)

    expect(layout.navigation.map((group) => group.title)).toEqual([
      'Getting started',
      'Learn',
      'Vidact Start',
      'Guides',
      'Reference',
      'Under the hood',
    ])
    expect(navigation.map((item) => item.url)).toEqual([
      '/docs',
      '/docs/getting-started/quick-start',
      '/docs/getting-started/installation',
      '/docs/learn/thinking-in-vidact',
      '/docs/learn/components-and-props',
      '/docs/learn/state',
      '/docs/learn/events',
      '/docs/learn/forms',
      '/docs/learn/conditional-rendering',
      '/docs/learn/lists-and-keys',
      '/docs/learn/effects',
      '/docs/learn/refs',
      '/docs/learn/context',
      '/docs/learn/error-handling',
      '/docs/learn/features',
      '/docs/start/getting-started',
      '/docs/start/routing',
      '/docs/start/data-loading',
      '/docs/start/navigation',
      '/docs/start/deployment',
      '/docs/guides/migrating-from-react',
      '/docs/guides/testing',
      '/docs/guides/troubleshooting',
      '/docs/reference/vite',
      '/docs/reference/runtime',
      '/docs/reference/start',
      '/docs/reference/compiler',
      '/docs/reference/react-compatibility',
      '/docs/internals/compilation',
      '/docs/internals/reactivity',
      '/docs/internals/ownership',
      '/docs/internals/server-rendering',
    ])
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
    expect(body).toContain('\\"language\\",\\"tsx\\"')
    expect(body).toContain('#85E89D')
    expect(body).not.toContain('<!doctype html>')
  })

  it('returns 404 for an unknown document', async () => {
    const response = await handler(new Request('https://example.test/docs/not-a-page'))

    expect(response.status).toBe(404)
  })
})
