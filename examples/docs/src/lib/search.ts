import type { DocsSearchResult } from './search-types.ts'

export const OPEN_DOCS_SEARCH = 'vidact:open-docs-search'

export function openDocsSearch(): void {
  document.dispatchEvent(new Event(OPEN_DOCS_SEARCH))
}

export async function fetchDocsSearch(
  query: string,
  signal: AbortSignal,
): Promise<DocsSearchResult[]> {
  const response = await fetch(`/api/search?${new URLSearchParams({ query })}`, { signal })
  if (!response.ok) throw new Error('Search is unavailable. Please try again.')
  return response.json()
}
