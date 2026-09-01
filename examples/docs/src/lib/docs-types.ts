export type NavigationItem = {
  readonly group: DocumentationGroup
  readonly title: string
  readonly url: string
}

export type DocumentationGroup = 'Overview' | 'Tutorials' | 'How-to guides' | 'Reference' | 'Explanation'

export type DocumentKind = 'Overview' | 'Tutorial' | 'How-to guide' | 'Reference' | 'Explanation'

export type NavigationGroup = {
  readonly items: readonly NavigationItem[]
  readonly title: DocumentationGroup
}

export type DocBlock =
  | { readonly key: string; readonly text: string; readonly type: 'paragraph' }
  | { readonly items: readonly string[]; readonly key: string; readonly type: 'list' }
  | {
      readonly code: string
      readonly key: string
      readonly language: string
      readonly lines: readonly {
        readonly key: string
        readonly tokens: readonly {
          readonly color: string
          readonly content: string
          readonly key: string
        }[]
      }[]
      readonly type: 'code'
    }
  | {
      readonly key: string
      readonly text: string
      readonly title: string
      readonly tone?: 'note' | 'warning'
      readonly type: 'callout'
    }
  | {
      readonly headers: readonly string[]
      readonly key: string
      readonly rows: readonly {
        readonly cells: readonly string[]
        readonly key: string
      }[]
      readonly type: 'table'
    }
  | {
      readonly items: readonly string[]
      readonly key: string
      readonly type: 'steps'
    }
  | {
      readonly key: string
      readonly variant: 'buttons' | 'cards' | 'counter' | 'switch'
      readonly type: 'preview'
    }

export type DocSection = {
  readonly blocks: readonly DocBlock[]
  readonly id: string
  readonly title: string
}

export type LoadedDocPage = {
  readonly description: string
  readonly kind: DocumentKind
  readonly next: NavigationItem | null
  readonly previous: NavigationItem | null
  readonly sections: readonly DocSection[]
  readonly title: string
  readonly url: string
}
