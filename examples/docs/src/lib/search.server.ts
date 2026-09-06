import { createFromSource } from 'fumadocs-core/search/server'

import { searchStructure } from './docs-content.ts'
import { MAX_SEARCH_LENGTH, type DocsSearchResult } from './search-types.ts'
import { source } from './source.server.ts'

const search = createFromSource(source, {
  buildIndex: (page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title ?? 'Documentation',
    description: page.data.description ?? '',
    structuredData: searchStructure(page.data.sections),
  }),
})
const pages = new Map(source.getPages().map((page) => [page.url, page]))

export async function searchDocs(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('query')?.trim() ?? ''
  if (query.length > MAX_SEARCH_LENGTH) {
    return Response.json(
      { error: `Use ${MAX_SEARCH_LENGTH} characters or fewer.` },
      { status: 400 },
    )
  }
  if (query === '') return Response.json([])
  const matches = await search.search(query, { limit: 12 })
  const results: DocsSearchResult[] = matches.slice(0, 20).map((match) => {
    const page = pages.get(match.url.split('#')[0]!)!
    return {
      id: match.id,
      url: match.url,
      title: page.data.title ?? 'Documentation',
      group: page.data.group,
      content: match.content.replace(/<\/?mark>/gu, ''),
      type: match.type,
    }
  })
  return Response.json(results)
}
