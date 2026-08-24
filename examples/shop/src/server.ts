import { jsx as serverJsx, type ServerChild, type ServerComponent } from '@vidact/runtime/server'
import { renderToReadableStream } from 'react-dom/server'

import { handleApiRequest } from './backend.ts'
import { listProducts } from './catalog.ts'
import type { Product } from './model.ts'
import { ShopApp } from './ShopApp.tsx'

export interface ShopPageAssets {
  readonly clientEntry: string
  readonly stylesheet: string
}

const PRODUCTION_ASSETS: ShopPageAssets = {
  clientEntry: '/assets/client.js',
  stylesheet: '/assets/style.css',
}

export async function renderShopPage(
  suppliedProducts?: readonly Product[],
  assets: ShopPageAssets = PRODUCTION_ASSETS,
): Promise<string> {
  const products = suppliedProducts ?? (await listProducts('all', 80))
  const productsPromise = Promise.resolve(products)
  const stream = await renderToReadableStream(
    () =>
      serverJsx(ShopApp as unknown as ServerComponent, {
        productsPromise,
      }) as ServerChild,
    {
      identifierPrefix: 'shop-',
      progressiveChunkSize: 16_384,
    },
  )
  const application = await new Response(stream).text()
  const initialData = escapeInlineJson(JSON.stringify({ products }))

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="A complete Vidact shop with SSR, Suspense, hydration, and a JSON backend." />
    <meta name="theme-color" content="#f1efe8" />
    <title>Northstar Supply · Vidact Shop</title>
    <link rel="stylesheet" href="${assets.stylesheet}" />
  </head>
  <body>
    <div id="shop-root">${application}</div>
    <script id="shop-data" type="application/json">${initialData}</script>
    <script type="module" src="${assets.clientEntry}"></script>
  </body>
</html>`
}

export async function handleShopRequest(
  request: Request,
  assets: ShopPageAssets = PRODUCTION_ASSETS,
): Promise<Response> {
  const requestUrl = new URL(request.url)

  if (requestUrl.pathname.startsWith('/api/')) {
    return (
      (await handleApiRequest(request)) ?? Response.json({ error: 'Not found.' }, { status: 404 })
    )
  }

  if (request.method === 'GET' && requestUrl.pathname === '/') {
    return new Response(await renderShopPage(undefined, assets), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function escapeInlineJson(value: string): string {
  return value
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}
