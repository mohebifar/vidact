import { createProcessor } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import { createHighlighterCore } from 'shiki/core'
import html from 'shiki/dist/langs/html.mjs'
import json from 'shiki/dist/langs/json.mjs'
import shellscript from 'shiki/dist/langs/shellscript.mjs'
import tsx from 'shiki/dist/langs/tsx.mjs'
import typescript from 'shiki/dist/langs/typescript.mjs'
import githubDark from 'shiki/dist/themes/github-dark.mjs'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import type {
  DocBlock,
  DocCodeLine,
  DocInline,
  DocInlineLeaf,
  DocSection,
  DocumentationGroup,
} from './docs-types.ts'

export type DocumentationPage = {
  readonly description: string
  readonly group: DocumentationGroup
  readonly path: string
  readonly sections: readonly DocSection[]
  readonly title: string
}

type MdxNode = {
  readonly attributes?: readonly { readonly name?: string; readonly value?: unknown }[]
  readonly children?: readonly MdxNode[]
  readonly depth?: number
  readonly lang?: string | null
  readonly meta?: string | null
  readonly name?: string
  readonly ordered?: boolean
  readonly type: string
  readonly url?: string
  readonly value?: string
}

/** MDX sources are bundled at build time so the server does not read the filesystem. */
const contentModules = import.meta.glob('../../content/docs/**/*.mdx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Readonly<Record<string, string>>
const processor = createProcessor({ remarkPlugins: [remarkGfm] })
const highlighter = await createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [html, json, shellscript, tsx, typescript],
  themes: [githubDark],
})

export async function loadDocumentationPages(): Promise<readonly DocumentationPage[]> {
  const entries = Object.entries(contentModules).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )
  return Promise.all(
    entries.map(([modulePath, source]) =>
      parsePage(modulePath.replace(/^.*\/content\/docs\//u, ''), source),
    ),
  )
}

async function parsePage(filename: string, source: string): Promise<DocumentationPage> {
  const { body, metadata } = parseFrontmatter(source)
  const tree = processor.parse(body) as unknown as MdxNode
  return {
    path: filename,
    title: requiredMetadata(metadata, 'title'),
    description: requiredMetadata(metadata, 'description'),
    group: documentationGroup(requiredMetadata(metadata, 'group')),
    sections: await sectionsFromTree(tree),
  }
}

async function sectionsFromTree(root: MdxNode): Promise<readonly DocSection[]> {
  const sections: { id: string; title: string; nodes: MdxNode[] }[] = []
  let current = { id: '', title: '', nodes: [] as MdxNode[] }
  sections.push(current)

  for (const node of root.children ?? []) {
    if (node.type === 'heading' && node.depth === 2) {
      const title = textOf(node)
      current = { id: slug(title), title, nodes: [] }
      sections.push(current)
    } else {
      current.nodes.push(node)
    }
  }

  return Promise.all(
    sections
      .filter((section) => section.title !== '' || section.nodes.length > 0)
      .map(async (section) => ({
        id: section.id,
        title: section.title,
        blocks: await Promise.all(
          section.nodes.flatMap((node, index) =>
            blockFromNode(node, `${section.id || 'intro'}-${index}`),
          ),
        ),
      })),
  )
}

function blockFromNode(node: MdxNode, key: string): Promise<DocBlock>[] {
  if (node.type === 'paragraph') {
    return [Promise.resolve({ content: inlineOf(node, key), key, type: 'paragraph' })]
  }
  if (node.type === 'heading') {
    const text = textOf(node)
    return [Promise.resolve({ id: slug(text), key, text, type: 'heading' })]
  }
  if (node.type === 'list') {
    const items = (node.children ?? []).map((item, index) => ({
      content: listItemContent(item, `${key}-${index}`),
      key: `${key}-${index}`,
    }))
    return [Promise.resolve({ items, key, ordered: node.ordered === true, type: 'list' })]
  }
  if (node.type === 'code') {
    return [highlightCode(key, node.lang ?? 'text', node.value ?? '', codeTitle(node.meta))]
  }
  if (node.type === 'table') {
    const rows = (node.children ?? []).map((row, rowIndex) => ({
      key: `${key}-${rowIndex}`,
      cells: (row.children ?? []).map((cell, cellIndex) => ({
        content: inlineOf(cell, `${key}-${rowIndex}-${cellIndex}`),
        key: `${key}-${rowIndex}-${cellIndex}`,
      })),
    }))
    const [header, ...body] = rows
    return [Promise.resolve({ headers: header?.cells ?? [], key, rows: body, type: 'table' })]
  }
  if (node.type === 'blockquote') return [Promise.resolve(calloutFromBlockquote(node, key))]
  if (node.type === 'mdxJsxFlowElement' && node.name === 'Preview') {
    const variant = attribute(node, 'variant')
    if (variant === 'counter' || variant === 'list' || variant === 'toggle') {
      return [Promise.resolve({ key, type: 'preview', variant })]
    }
    throw new Error(`Unknown documentation preview variant ${String(variant)}`)
  }
  return []
}

/**
 * GitHub-style callouts:
 *
 * ```md
 * > [!TIP] Optional title
 * >
 * > Body paragraphs.
 * ```
 */
function calloutFromBlockquote(node: MdxNode, key: string): DocBlock {
  const paragraphs = (node.children ?? []).filter((child) => child.type === 'paragraph')
  const [first, ...rest] = paragraphs
  const firstText = first === undefined ? '' : textOf(first)
  const match = /^\[!(NOTE|TIP|WARNING)\]\s*([^\n]*)\n?([\s\S]*)$/u.exec(firstText)
  const tone = match?.[1] === 'WARNING' ? 'warning' : match?.[1] === 'TIP' ? 'tip' : 'note'
  const defaultTitle = tone === 'warning' ? 'Warning' : tone === 'tip' ? 'Tip' : 'Note'
  const title = match?.[2]?.trim() || defaultTitle

  const bodyParagraphs: { content: readonly DocInline[]; key: string }[] = []
  if (match === null) {
    if (first !== undefined)
      bodyParagraphs.push({ content: inlineOf(first, `${key}-0`), key: `${key}-0` })
  } else {
    const remainder = match[3]?.trim() ?? ''
    if (remainder !== '') {
      bodyParagraphs.push({
        content: [{ key: `${key}-0-0`, type: 'text', value: remainder }],
        key: `${key}-0`,
      })
    }
  }
  rest.forEach((paragraph, index) => {
    const paragraphKey = `${key}-${index + 1}`
    bodyParagraphs.push({ content: inlineOf(paragraph, paragraphKey), key: paragraphKey })
  })

  return { key, paragraphs: bodyParagraphs, title, tone, type: 'callout' }
}

function listItemContent(item: MdxNode, key: string): readonly DocInline[] {
  const content: DocInline[] = []
  for (const [index, child] of (item.children ?? []).entries()) {
    if (child.type !== 'paragraph') continue
    if (content.length > 0) content.push({ key: `${key}-break-${index}`, type: 'break' })
    content.push(...inlineOf(child, `${key}-${index}`))
  }
  return content
}

function inlineOf(parent: MdxNode, key: string): readonly DocInline[] {
  return (parent.children ?? []).flatMap((child, index): DocInline[] => {
    const childKey = `${key}-${index}`
    switch (child.type) {
      case 'text':
        return [{ key: childKey, type: 'text', value: child.value ?? '' }]
      case 'inlineCode':
        return [{ key: childKey, type: 'code', value: child.value ?? '' }]
      case 'break':
        return [{ key: childKey, type: 'break' }]
      case 'strong':
        return [{ children: leavesOf(child, childKey), key: childKey, type: 'strong' }]
      case 'emphasis':
        return [{ children: leavesOf(child, childKey), key: childKey, type: 'emphasis' }]
      case 'link':
        return [
          {
            children: leavesOf(child, childKey),
            href: child.url ?? '#',
            key: childKey,
            type: 'link',
          },
        ]
      default:
        return [{ key: childKey, type: 'text', value: textOf(child) }]
    }
  })
}

function leavesOf(parent: MdxNode, key: string): readonly DocInlineLeaf[] {
  return (parent.children ?? []).map((child, index) =>
    child.type === 'inlineCode'
      ? { key: `${key}-${index}`, type: 'code', value: child.value ?? '' }
      : { key: `${key}-${index}`, type: 'text', value: textOf(child) },
  )
}

async function highlightCode(
  key: string,
  language: string,
  source: string,
  title: string,
): Promise<DocBlock> {
  return {
    code: source,
    key,
    language,
    lines: highlightLines(source, language, key),
    title,
    type: 'code',
  }
}

/** Tokenize a snippet with the shared Shiki instance. Server only. */
export function highlightLines(
  source: string,
  language: string,
  keyPrefix: string,
): readonly DocCodeLine[] {
  const lang =
    language === 'shell' || language === 'sh'
      ? 'shellscript'
      : language === 'ts'
        ? 'typescript'
        : language
  const highlighted = highlighter.codeToTokens(source, {
    lang: highlighter.getLoadedLanguages().includes(lang) ? lang : 'text',
    theme: 'github-dark',
  })
  return highlighted.tokens.map((tokens, lineIndex) => ({
    key: `${keyPrefix}-${lineIndex}`,
    tokens: tokens.map((token, tokenIndex) => ({
      color: token.color ?? '#f0f6fc',
      content: token.content,
      key: `${keyPrefix}-${lineIndex}-${tokenIndex}`,
    })),
  }))
}

/** Reads `title="..."` from a fenced code block's info string. */
function codeTitle(meta: string | null | undefined): string {
  const match = /title="([^"]*)"/u.exec(meta ?? '')
  return match?.[1] ?? ''
}

function parseFrontmatter(source: string): {
  readonly body: string
  readonly metadata: Readonly<Record<string, string>>
} {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(source)
  if (match === null) throw new Error('Documentation MDX must start with frontmatter')
  const metadata: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, '')
    metadata[key] = value
  }
  return { body: source.slice(match[0].length), metadata }
}

function requiredMetadata(metadata: Readonly<Record<string, string>>, key: string): string {
  const value = metadata[key]
  if (value === undefined || value === '') throw new Error(`Documentation MDX is missing ${key}`)
  return value
}

function textOf(node: MdxNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? [])
    .map((child) => textOf(child))
    .join(node.type === 'blockquote' ? '\n' : '')
}

function attribute(node: MdxNode, name: string): string | undefined {
  const value = node.attributes?.find((item) => item.name === name)?.value
  return typeof value === 'string' ? value : undefined
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
}

function documentationGroup(value: string): DocumentationGroup {
  if (
    value === 'Getting started' ||
    value === 'Learn' ||
    value === 'Vidact Start' ||
    value === 'Guides' ||
    value === 'Reference' ||
    value === 'Under the hood'
  ) {
    return value
  }
  throw new Error(`Unknown documentation group ${value}`)
}
