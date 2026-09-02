export type DocumentationGroup =
  | 'Getting started'
  | 'Learn'
  | 'Vidact Start'
  | 'Guides'
  | 'Reference'
  | 'Under the hood'

export type NavigationItem = {
  readonly group: DocumentationGroup
  readonly title: string
  readonly url: string
}

export type NavigationGroup = {
  readonly items: readonly NavigationItem[]
  readonly title: DocumentationGroup
}

/** Leaf inline content: plain text or an inline code span. */
export type DocInlineLeaf =
  | { readonly key: string; readonly type: 'text'; readonly value: string }
  | { readonly key: string; readonly type: 'code'; readonly value: string }

/** Inline content inside paragraphs, list items, table cells, and callouts. */
export type DocInline =
  | DocInlineLeaf
  | { readonly key: string; readonly type: 'break' }
  | { readonly children: readonly DocInlineLeaf[]; readonly key: string; readonly type: 'strong' }
  | { readonly children: readonly DocInlineLeaf[]; readonly key: string; readonly type: 'emphasis' }
  | {
      readonly children: readonly DocInlineLeaf[]
      readonly href: string
      readonly key: string
      readonly type: 'link'
    }

export type DocCodeLine = {
  readonly key: string
  readonly tokens: readonly {
    readonly color: string
    readonly content: string
    readonly key: string
  }[]
}

export type PreviewVariant = 'counter' | 'list' | 'toggle'

export type DocBlock =
  | { readonly content: readonly DocInline[]; readonly key: string; readonly type: 'paragraph' }
  | { readonly id: string; readonly key: string; readonly text: string; readonly type: 'heading' }
  | {
      readonly items: readonly { readonly content: readonly DocInline[]; readonly key: string }[]
      readonly key: string
      readonly ordered: boolean
      readonly type: 'list'
    }
  | {
      readonly code: string
      readonly key: string
      readonly language: string
      readonly lines: readonly DocCodeLine[]
      readonly title: string
      readonly type: 'code'
    }
  | {
      readonly key: string
      readonly paragraphs: readonly {
        readonly content: readonly DocInline[]
        readonly key: string
      }[]
      readonly title: string
      readonly tone: 'note' | 'tip' | 'warning'
      readonly type: 'callout'
    }
  | {
      readonly headers: readonly { readonly content: readonly DocInline[]; readonly key: string }[]
      readonly key: string
      readonly rows: readonly {
        readonly cells: readonly { readonly content: readonly DocInline[]; readonly key: string }[]
        readonly key: string
      }[]
      readonly type: 'table'
    }
  | { readonly key: string; readonly type: 'preview'; readonly variant: PreviewVariant }

export type DocSection = {
  readonly blocks: readonly DocBlock[]
  /** Empty for the page introduction that precedes the first `##` heading. */
  readonly id: string
  readonly title: string
}

export type LoadedDocPage = {
  readonly description: string
  readonly group: DocumentationGroup
  readonly next: NavigationItem | null
  readonly previous: NavigationItem | null
  readonly sections: readonly DocSection[]
  readonly title: string
  readonly url: string
}
