import {
  binding,
  compiledEvent,
  compiledLayoutEffect,
  compiledRoot,
  createCompiledProp,
  createCompiledScope,
  createCompiledState,
  h,
  source,
  type CompiledRenderValue,
  type DirectComponent,
} from '@vidact/runtime'
import { createElement as createServerElement, type ServerChild } from '@vidact/runtime/server'
import { assertMutationEnvelope, captureMutations } from '@vidact/test-support'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hydrateStart } from '../../../../../packages/start/src/client.ts'
import { createRouteManifest, defineFileRoute } from '../../../../../packages/start/src/router.ts'
import { createStartHandler } from '../../../../../packages/start/src/server.ts'
import {
  encodeStartSnapshot,
  VIDACT_START_NAVIGATION_HEADER,
  VIDACT_START_PROTOCOL,
  VIDACT_START_SNAPSHOT_MEDIA_TYPE,
} from '../../../../../packages/start/src/snapshot.ts'

const lifecycle = {
  about: { disposed: 0, mounted: 0 },
  leaf: { disposed: 0, mounted: 0 },
  products: { disposed: 0, mounted: 0 },
  root: { disposed: 0, mounted: 0 },
}

let serverTarget = true

const manifest = createRouteManifest([
  route('__root', null, '/', RootLayout, ServerRootLayout, () => ({ shell: 'root' })),
  route('products', '__root', '/products/*', ProductsLayout, ServerProductsLayout, () => ({
    section: 'products',
  })),
  route(
    'product',
    'products',
    '/products/:productId',
    ProductPage,
    ServerProductPage,
    ({ request }) => ({
      label: `${new URL(request.url).pathname}${new URL(request.url).search}`,
    }),
  ),
  route('about', '__root', '/about', AboutPage, ServerAboutPage, () => ({ label: 'about' })),
])

const handler = createStartHandler({ manifest })

describe('Start retained layout navigation', () => {
  beforeEach(() => {
    serverTarget = true
    for (const count of Object.values(lifecycle)) {
      count.disposed = 0
      count.mounted = 0
    }
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('retains shared owners, updates route props, and replaces only the changed suffix', async () => {
    const client = await renderAndHydrate('/products/a?revision=1')
    await Promise.resolve()
    const host = document.querySelector('#vidact-start-root')!
    const rootLayout = host.querySelector('#root-layout')!
    const productsLayout = host.querySelector('#products-layout')!
    const firstLeaf = host.querySelector('#product-page')!

    click('#root-count')
    click('#products-count')
    click('#leaf-count')
    expect(text('#root-value')).toBe('1')
    expect(text('#products-value')).toBe('1')
    expect(text('#leaf-value')).toBe('1')

    const siblingMutations = await captureMutations(host, () =>
      client.navigate('/products/b?revision=2', { scroll: false }),
    )

    expect(host.querySelector('#root-layout')).toBe(rootLayout)
    expect(host.querySelector('#products-layout')).toBe(productsLayout)
    expect(host.querySelector('#product-page')).toBe(firstLeaf)
    expect(text('#root-value')).toBe('1')
    expect(text('#products-value')).toBe('1')
    expect(text('#leaf-value')).toBe('1')
    expect(text('#product-label')).toBe('/products/b?revision=2')
    expect(text('#product-param')).toBe('b')
    expect(text('#root-url')).toContain('/products/b?revision=2')
    expect(lifecycle).toMatchObject({
      leaf: { disposed: 0, mounted: 1 },
      products: { disposed: 0, mounted: 1 },
      root: { disposed: 0, mounted: 1 },
    })
    expect(() =>
      assertMutationEnvelope(
        siblingMutations.records,
        [{ type: 'characterData', within: rootLayout }],
        'retained Start sibling navigation',
      ),
    ).not.toThrow()
    expect(siblingMutations.records.length).toBeLessThanOrEqual(14)

    const retainedLeaf = host.querySelector('#product-page')!
    click('#leaf-count')
    await client.navigate('/products/b?revision=3', { scroll: false })
    expect(host.querySelector('#product-page')).toBe(retainedLeaf)
    expect(text('#leaf-value')).toBe('2')
    expect(text('#product-label')).toBe('/products/b?revision=3')
    expect(lifecycle.leaf).toEqual({ disposed: 0, mounted: 1 })

    await client.navigate('/about', { scroll: false })
    expect(host.querySelector('#root-layout')).toBe(rootLayout)
    expect(host.querySelector('#products-layout')).toBeNull()
    expect(text('#about-label')).toBe('about')
    expect(lifecycle.products.disposed).toBe(1)
    expect(lifecycle.leaf.disposed).toBe(1)

    window.history.back()
    await waitFor(() => window.location.pathname === '/products/b')
    await waitFor(() => host.querySelector('#products-layout') !== null)
    expect(host.querySelector('#root-layout')).toBe(rootLayout)
    expect(text('#product-label')).toBe('/products/b?revision=3')

    window.history.forward()
    await waitFor(() => window.location.pathname === '/about')
    await waitFor(() => host.querySelector('#about-page') !== null)
    expect(host.querySelector('#root-layout')).toBe(rootLayout)
    expect(text('#about-label')).toBe('about')

    client.unmount()
    expect(lifecycle.root.disposed).toBe(1)
  })

  it('lets only the latest navigation publish and leaves failed loader work untouched', async () => {
    let releaseSlow!: (response: Response) => void
    const slow = new Promise<Response>((resolve) => {
      releaseSlow = resolve
    })
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      )
      if (url.searchParams.has('slow')) return slow
      if (url.hash === '#fail') return failedPublicationResponse()
      return handler(new Request(url, init))
    }
    const hydrated = await renderAndHydrate('/products/a', fetch)
    const host = document.querySelector('#vidact-start-root')!
    const rootLayout = host.querySelector('#root-layout')!
    const productsLayout = host.querySelector('#products-layout')!

    const stale = hydrated.navigate('/products/b?slow=1', { scroll: false })
    const latest = hydrated.navigate('/products/b?revision=2', { scroll: false })
    await expect(latest).resolves.toBe(true)
    releaseSlow(
      await handler(
        new Request(new URL('/products/b?slow=1', window.location.href), {
          headers: { [VIDACT_START_NAVIGATION_HEADER]: '1' },
        }),
      ),
    )
    await expect(stale).resolves.toBe(false)
    expect(text('#product-label')).toBe('/products/b?revision=2')

    const currentLeaf = host.querySelector('#product-page')
    await expect(hydrated.navigate('/products/b?revision=2#fail', { scroll: false })).resolves.toBe(
      false,
    )
    expect(host.querySelector('#root-layout')).toBe(rootLayout)
    expect(host.querySelector('#products-layout')).toBe(productsLayout)
    expect(host.querySelector('#product-page')).toBe(currentLeaf)
    expect(text('#product-label')).toBe('/products/b?revision=2')
    hydrated.unmount()
  })
})

function route(
  id: string,
  parentId: string | null,
  path: string,
  client: DirectComponent,
  server: (props: Record<string, unknown>) => ServerChild,
  loader: (context: { readonly request: Request }) => unknown,
) {
  return {
    id,
    parentId,
    path,
    load: async () => ({
      Route: defineFileRoute({
        component: (serverTarget ? server : client) as never,
        loader: loader as never,
      }),
    }),
  }
}

function trackedComponent(
  name: keyof typeof lifecycle,
  id: string,
  render: (scope: ReturnType<typeof createCompiledScope>) => CompiledRenderValue,
): CompiledRenderValue {
  lifecycle[name].mounted += 1
  const scope = createCompiledScope()
  compiledLayoutEffect(scope, 0, () => () => () => {
    lifecycle[name].disposed += 1
  })
  return compiledRoot(scope, () => {
    const children = render(scope)
    return Array.isArray(children)
      ? h('section', { id }, ...children)
      : h('section', { id }, children)
  })
}

function RootLayout(props: Record<string, unknown>): CompiledRenderValue {
  return trackedLayout('root', 'root-layout', props)
}

function ProductsLayout(props: Record<string, unknown>): CompiledRenderValue {
  return trackedLayout('products', 'products-layout', props)
}

function trackedLayout(
  name: 'products' | 'root',
  id: string,
  props: Record<string, unknown>,
): CompiledRenderValue {
  return trackedComponent(name, id, (scope) => {
    const children = createCompiledProp(scope, source(0), props.children as CompiledRenderValue)
    const requestUrl = createCompiledProp(scope, source(1), props.requestUrl as string)
    const count = createCompiledState(scope, source(2), 0)
    return [
      h(
        'button',
        {
          id: `${name}-count`,
          onClick: compiledEvent(scope, () => count.set((value) => value + 1)),
        },
        'increment',
      ),
      h('output', { id: `${name}-value` }, binding(scope, source(2), count.get)),
      h('span', { id: `${name}-url` }, binding(scope, source(1), requestUrl.get)),
      h('div', { className: `${name}-outlet` }, binding(scope, source(0), children.get)),
    ]
  })
}

function ProductPage(props: Record<string, unknown>): CompiledRenderValue {
  return trackedComponent('leaf', 'product-page', (scope) => {
    const loaderData = createCompiledProp(
      scope,
      source(0),
      props.loaderData as { readonly label: string },
    )
    const params = createCompiledProp(
      scope,
      source(1),
      props.params as { readonly productId: string },
    )
    const count = createCompiledState(scope, source(2), 0)
    return [
      h(
        'strong',
        { id: 'product-label' },
        binding(scope, source(0), () => {
          const label = loaderData.get().label
          if (label === 'throw') throw new Error('route publication failed')
          return label
        }),
      ),
      h(
        'span',
        { id: 'product-param' },
        binding(scope, source(1), () => params.get().productId),
      ),
      h(
        'button',
        { id: 'leaf-count', onClick: compiledEvent(scope, () => count.set((value) => value + 1)) },
        'increment',
      ),
      h('output', { id: 'leaf-value' }, binding(scope, source(2), count.get)),
    ]
  })
}

function AboutPage(props: Record<string, unknown>): CompiledRenderValue {
  return trackedComponent('about', 'about-page', (scope) => {
    const loaderData = createCompiledProp(
      scope,
      source(0),
      props.loaderData as { readonly label: string },
    )
    return h(
      'strong',
      { id: 'about-label' },
      binding(scope, source(0), () => loaderData.get().label),
    )
  })
}

function ServerRootLayout(props: Record<string, unknown>): ServerChild {
  return serverLayout('root', 'root-layout', props)
}

function ServerProductsLayout(props: Record<string, unknown>): ServerChild {
  return serverLayout('products', 'products-layout', props)
}

function serverLayout(name: 'products' | 'root', id: string, props: Record<string, unknown>) {
  return createServerElement(
    'section',
    { id },
    createServerElement('button', { id: `${name}-count` }, 'increment'),
    createServerElement('output', { id: `${name}-value` }, '0'),
    createServerElement('span', { id: `${name}-url` }, props.requestUrl as string),
    createServerElement('div', { className: `${name}-outlet` }, props.children as ServerChild),
  )
}

function ServerProductPage(props: Record<string, unknown>): ServerChild {
  const loaderData = props.loaderData as { readonly label: string }
  const params = props.params as { readonly productId: string }
  return createServerElement(
    'section',
    { id: 'product-page' },
    createServerElement('strong', { id: 'product-label' }, loaderData.label),
    createServerElement('span', { id: 'product-param' }, params.productId),
    createServerElement('button', { id: 'leaf-count' }, 'increment'),
    createServerElement('output', { id: 'leaf-value' }, '0'),
  )
}

function ServerAboutPage(props: Record<string, unknown>): ServerChild {
  const loaderData = props.loaderData as { readonly label: string }
  return createServerElement(
    'section',
    { id: 'about-page' },
    createServerElement('strong', { id: 'about-label' }, loaderData.label),
  )
}

async function renderAndHydrate(pathname: string, fetch?: typeof globalThis.fetch) {
  window.history.replaceState({}, '', pathname)
  const response = await handler(new Request(window.location.href))
  const page = new DOMParser().parseFromString(await response.text(), 'text/html')
  document.body.innerHTML = page.body.innerHTML
  serverTarget = false
  return hydrateExisting(fetch ?? ((input, init) => handler(new Request(input, init))))
}

async function hydrateExisting(fetch: typeof globalThis.fetch) {
  return hydrateStart({
    onRecoverableError(error) {
      throw error
    },
    manifest,
    root: document.querySelector('#vidact-start-root')!,
    snapshot: document.querySelector('#vidact-start-snapshot')!.textContent ?? '',
    fetch,
  })
}

function failedPublicationResponse(): Response {
  return new Response(
    encodeStartSnapshot({
      protocol: VIDACT_START_PROTOCOL,
      pathname: '/products/b?revision=2',
      loaderData: {
        __root: { shell: 'root' },
        product: { label: 'throw' },
        products: { section: 'products' },
      },
    }),
    { headers: { 'content-type': VIDACT_START_SNAPSHOT_MEDIA_TYPE } },
  )
}

function click(selector: string): void {
  document.querySelector<HTMLElement>(selector)!.click()
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? ''
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    // oxlint-disable-next-line eslint/no-await-in-loop -- Polling is intentionally sequential.
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for browser navigation')
}
