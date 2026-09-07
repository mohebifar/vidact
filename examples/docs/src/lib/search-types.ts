export interface DocsSearchResult {
  readonly id: string
  readonly url: string
  readonly title: string
  readonly group: string
  readonly content: string
  readonly type: 'page' | 'heading' | 'text'
}

export const MAX_SEARCH_LENGTH = 200
