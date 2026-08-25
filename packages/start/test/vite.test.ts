import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { routeFileToRecord, vidactStart } from '../src/vite.ts'

describe('Vidact Start Vite routes', () => {
  const directory = path.resolve('/application/src/routes')

  it.each([
    ['__root.tsx', '__root', '/'],
    ['index.tsx', 'index', '/'],
    ['about.tsx', 'about', '/about'],
    ['products/index.tsx', 'products/index', '/products'],
    ['products/$productId.tsx', 'products/$productId', '/products/:productId'],
    ['docs/$.tsx', 'docs/$', '/docs/*'],
    ['_authenticated/dashboard.tsx', '_authenticated/dashboard', '/dashboard'],
  ])('derives %s as %s at %s', (filename, id, routePath) => {
    expect(routeFileToRecord(filename, directory)).toEqual({
      file: path.resolve(directory, filename),
      id,
      parentId: null,
      path: routePath,
    })
  })

  it('installs hydration, server, and route-manifest plugins together', () => {
    expect(vidactStart().map((plugin) => plugin.name)).toEqual([
      'vidact:start:client',
      'vidact:start:ssr',
      'vidact-start-routes',
      'vidact-start-development-server',
    ])
  })

  it('can leave development request handling to a custom adapter', () => {
    expect(vidactStart({ serverEntry: false }).map((plugin) => plugin.name)).not.toContain(
      'vidact-start-development-server',
    )
  })
})
