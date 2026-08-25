import {
  createElement,
  renderToStaticMarkup,
  type ServerChild,
  type ServerComponent,
} from '@vidact/runtime/server'
import { describe, expect, it } from 'vitest'

import { Link } from '../src/link.ts'

describe('Vidact Start Link', () => {
  it('marks ordinary links for client navigation', () => {
    const html = renderToStaticMarkup(
      () =>
        createElement(Link as unknown as ServerComponent, {
          href: '/products',
          replace: true,
          children: 'Products',
        }) as ServerChild,
    )

    expect(html).toBe(
      '<a data-vidact-start-link="" data-vidact-start-replace="" href="/products">Products</a>',
    )
  })

  it('can request normal document navigation', () => {
    const html = renderToStaticMarkup(
      () =>
        createElement(Link as unknown as ServerComponent, {
          href: '/download',
          reloadDocument: true,
          children: 'Download',
        }) as ServerChild,
    )

    expect(html).toBe('<a href="/download">Download</a>')
  })
})
