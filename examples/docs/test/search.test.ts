import { describe, expect, it } from 'vitest'

import type { DocsSearchResult } from '../src/lib/search-types.ts'
import { searchDocs } from '../src/lib/search.server.ts'
import { source } from '../src/lib/source.server.ts'

describe('Fumadocs search', () => {
  it('indexes API names, body text, and rendered heading anchors', async () => {
    const response = await searchDocs(new Request('https://example.test/api/search?query=useState'))
    const results: DocsSearchResult[] = await response.json()
    expect(results.some((r) => r.url.startsWith('/docs/learn/state'))).toBe(true)
    expect(results.some((r) => r.type === 'heading' && r.url.includes('#'))).toBe(true)
    for (const result of results) {
      const [path, id] = result.url.split('#')
      const page = source.getPages().find((p) => p.url === path)!
      expect(page).toBeDefined()
      const ids = page.data.sections.flatMap((section) =>
        [section.id].concat(
          section.blocks.flatMap((block) => (block.type === 'heading' ? [block.id] : [])),
        ),
      )
      expect(ids).toContain(id ?? '')
      expect(result.content).not.toContain('<mark>')
    }
  })

  it('returns empty results for blank and missing queries and bounds query size', async () => {
    await Promise.all(
      ['', '   ', 'xyzzynonexistent987654321'].map(async (query) => {
        const response = await searchDocs(
          new Request(`https://example.test/api/search?${new URLSearchParams({ query })}`),
        )
        expect(await response.json()).toEqual([])
      }),
    )
    expect(
      (await searchDocs(new Request(`https://example.test/api/search?query=${'a'.repeat(201)}`)))
        .status,
    ).toBe(400)
  })
})
