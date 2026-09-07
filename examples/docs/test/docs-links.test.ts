import { expect, it } from 'vitest'

import { source } from '../src/lib/source.server.ts'

it('resolves every internal documentation link and heading fragment', () => {
  const pages = new Map(source.getPages().map((page) => [page.url, page]))
  for (const page of pages.values()) {
    for (const href of links(page.data.sections)) {
      if (!href.startsWith('/') && !href.startsWith('#')) continue
      const url = new URL(href, `https://vidact.local${page.url}`)
      if (url.pathname === '/') continue
      const target = pages.get(url.pathname)
      expect(target, `${page.url} links to missing ${href}`).toBeDefined()
      if (!url.hash || !target) continue
      const ids = target.data.sections.flatMap((section) =>
        [section.id].concat(
          section.blocks.flatMap((block) => (block.type === 'heading' ? [block.id] : [])),
        ),
      )
      expect(ids, `${page.url} links to missing ${href}`).toContain(
        decodeURIComponent(url.hash.slice(1)),
      )
    }
  }
})

function links(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(links)
  if (typeof value !== 'object' || value === null) return []
  if ('type' in value && value.type === 'link' && 'href' in value && typeof value.href === 'string')
    return [value.href]
  return Object.values(value).flatMap(links)
}
