import { findNeighbour, flattenTree, type Item as PageTreeItem } from 'fumadocs-core/page-tree'
import { loader, type MetaData, type PageData, type StaticSource } from 'fumadocs-core/source'

import type {
  DocSection,
  DocumentationGroup,
  LoadedDocPage,
  NavigationGroup,
  NavigationItem,
} from './docs-types.ts'
import { loadDocumentationPages } from './mdx.server.ts'

type ContentPageData = PageData & {
  readonly group: DocumentationGroup
  readonly sections: readonly DocSection[]
}

const documentationPages = await loadDocumentationPages()
const pageFiles = documentationPages.map(({ path, ...data }) => ({
  data,
  path,
  type: 'page' as const,
}))

const files: StaticSource<{ pageData: ContentPageData; metaData: MetaData }>['files'] = [
  ...pageFiles,
  {
    type: 'meta',
    path: 'meta.json',
    data: {
      title: 'Vidact',
      pages: ['index', 'getting-started', 'learn', 'start', 'guides', 'reference', 'internals'],
    },
  },
  folderMeta('getting-started', 'Getting started', ['quick-start', 'installation']),
  folderMeta('learn', 'Learn', [
    'thinking-in-vidact',
    'components-and-props',
    'state',
    'events',
    'forms',
    'conditional-rendering',
    'lists-and-keys',
    'effects',
    'refs',
    'context',
    'error-handling',
    'features',
  ]),
  folderMeta('start', 'Vidact Start', [
    'getting-started',
    'routing',
    'data-loading',
    'navigation',
    'deployment',
  ]),
  folderMeta('guides', 'Guides', ['migrating-from-react', 'testing', 'troubleshooting']),
  folderMeta('reference', 'Reference', [
    'vite',
    'runtime',
    'start',
    'compiler',
    'react-compatibility',
  ]),
  folderMeta('internals', 'Under the hood', [
    'compilation',
    'reactivity',
    'ownership',
    'server-rendering',
  ]),
]

const source = loader({
  baseUrl: '/docs',
  source: { files },
})
const pageTree = source.getPageTree()
const pagesByUrl = new Map(source.getPages().map((page) => [page.url, page]))
const navigation = flattenTree(pageTree.children).map((item) => navigationItem(item))
const navigationGroups = groupNavigation(navigation)
const navigationByUrl = new Map(navigation.map((item) => [item.url, item]))

export async function loadDocsNavigation(): Promise<{ navigation: readonly NavigationGroup[] }> {
  return { navigation: navigationGroups }
}

export async function loadDocPage(slugs: readonly string[]): Promise<LoadedDocPage> {
  const page = source.getPage([...slugs])
  if (page === undefined) {
    throw new Response(`Unknown documentation page: ${slugs.join('/')}`, { status: 404 })
  }

  const neighbours = findNeighbour(pageTree, page.url, { separateRoot: false })
  return {
    description: page.data.description ?? '',
    group: page.data.group,
    next: navigationByUrl.get(neighbours.next?.url ?? '') ?? null,
    previous: navigationByUrl.get(neighbours.previous?.url ?? '') ?? null,
    sections: page.data.sections,
    title: plainText(page.data.title) || page.slugs.at(-1) || 'Documentation',
    url: page.url,
  }
}

function navigationItem(item: PageTreeItem): NavigationItem {
  const page = pagesByUrl.get(item.url)
  if (page === undefined) throw new Error(`Documentation page is missing for ${item.url}`)
  return {
    group: page.data.group,
    title: plainText(item.name),
    url: item.url,
  }
}

function groupNavigation(items: readonly NavigationItem[]): readonly NavigationGroup[] {
  const order: readonly DocumentationGroup[] = [
    'Getting started',
    'Learn',
    'Vidact Start',
    'Guides',
    'Reference',
    'Under the hood',
  ]
  return order.flatMap((title) => {
    const groupItems = items.filter((item) => item.group === title)
    return groupItems.length === 0 ? [] : [{ title, items: groupItems }]
  })
}

function folderMeta(folder: string, title: string, pages: readonly string[]) {
  return {
    type: 'meta' as const,
    path: `${folder}/meta.json`,
    data: { title, pages: [...pages], defaultOpen: true },
  }
}

function plainText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value !== 'object' || value === null) return ''
  if ('value' in value && typeof value.value === 'string') return value.value
  if (!('children' in value) || !Array.isArray(value.children)) return ''
  return value.children.map((child) => plainText(child)).join('')
}
