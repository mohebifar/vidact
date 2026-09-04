import type { FrameworkValue } from '@vidact/runtime/framework/protocol'
import { describe, expect, it, vi } from 'vitest'

import {
  composeRouteMatches,
  createRouteManifest,
  defineFileRoute,
  type FileRouteDefinition,
  loadRouteMatches,
  matchRoutes,
  type RouteLoaderContext,
  type RouteManifestEntry,
} from '../src/index.ts'

function entry(
  id: string,
  path: string,
  parentId: string | null,
  definition: FileRouteDefinition = defineFileRoute({}),
): RouteManifestEntry {
  return { id, path, parentId, load: async () => ({ Route: definition }) }
}

describe('Vidact Start router', () => {
  it('matches the most specific nested route and decodes parameters', () => {
    const manifest = createRouteManifest([
      entry('__root', '/', null),
      entry('products', '/products', '__root'),
      entry('products/index', '/products', 'products'),
      entry('products/$productId', '/products/:productId', 'products'),
      entry('products/$', '/products/*', 'products'),
    ])

    expect(
      matchRoutes(manifest, '/products/ridge%20bottle').map((match) => [
        match.entry.id,
        match.params,
      ]),
    ).toEqual([
      ['__root', { productId: 'ridge bottle' }],
      ['products', { productId: 'ridge bottle' }],
      ['products/$productId', { productId: 'ridge bottle' }],
    ])
    expect(matchRoutes(manifest, '/products').map((match) => match.entry.id)).toEqual([
      '__root',
      'products',
      'products/index',
    ])
  })

  it('runs parent loaders in order and supplies their data to descendants', async () => {
    const order: string[] = []
    const rootLoader = vi.fn<() => { session: string }>(() => {
      order.push('root')
      return { session: 'ready' }
    })
    const productLoader = vi.fn<(context: RouteLoaderContext) => Record<string, FrameworkValue>>(
      ({ parentData, params }) => {
        order.push('product')
        return {
          parent: parentData['__root'],
          productId: params.productId,
        }
      },
    )
    const manifest = createRouteManifest([
      entry('__root', '/', null, defineFileRoute({ loader: rootLoader })),
      entry(
        'products/$productId',
        '/products/:productId',
        '__root',
        defineFileRoute({ loader: productLoader }),
      ),
    ])
    const request = new Request('https://example.test/products/bottle')

    const loaded = await loadRouteMatches(matchRoutes(manifest, '/products/bottle'), request)

    expect(order).toEqual(['root', 'product'])
    expect(loaded.map((match) => match.loaderData)).toEqual([
      { session: 'ready' },
      { parent: { session: 'ready' }, productId: 'bottle' },
    ])
  })

  it('composes layouts from the leaf outward', async () => {
    const Root = ({ children }: { children?: unknown }) => ({ root: children })
    const Page = ({ loaderData }: { loaderData: unknown }) => ({ page: loaderData })
    const manifest = createRouteManifest([
      entry('__root', '/', null, defineFileRoute({ component: Root })),
      entry('index', '/', '__root', defineFileRoute({ component: Page, loader: () => 'ready' })),
    ])
    const loaded = await loadRouteMatches(
      matchRoutes(manifest, '/'),
      new Request('https://example.test/'),
    )

    const rendered = composeRouteMatches(
      loaded,
      (component, props) => component(props),
      'https://example.test/',
    )

    expect(rendered).toEqual({ root: { page: 'ready' } })
  })
})
