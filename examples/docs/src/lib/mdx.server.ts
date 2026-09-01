import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createProcessor } from '@mdx-js/mdx'
import remarkGfm from 'remark-gfm'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import html from 'shiki/dist/langs/html.mjs'
import json from 'shiki/dist/langs/json.mjs'
import shellscript from 'shiki/dist/langs/shellscript.mjs'
import tsx from 'shiki/dist/langs/tsx.mjs'
import typescript from 'shiki/dist/langs/typescript.mjs'
import githubDark from 'shiki/dist/themes/github-dark.mjs'

import type {
  DocBlock,
  DocSection,
  DocumentKind,
  DocumentationGroup,
} from './docs-types.ts'

export type DocumentationPage = {
  readonly description: string
  readonly group: DocumentationGroup
  readonly kind: DocumentKind
  readonly path: string
  readonly sections: readonly DocSection[]
  readonly title: string
}

type MdxNode = {
  readonly attributes?: readonly { readonly name?: string; readonly value?: unknown }[]
  readonly children?: readonly MdxNode[]
  readonly depth?: number
  readonly lang?: string | null
  readonly name?: string
  readonly ordered?: boolean
  readonly type: string
  readonly value?: string
}

const contentDirectory = fileURLToPath(new URL('../../content/docs/', import.meta.url))
const processor = createProcessor({ remarkPlugins: [remarkGfm] })
const highlighter = await createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [html, json, shellscript, tsx, typescript],
  themes: [githubDark],
})

export async function loadDocumentationPages(): Promise<readonly DocumentationPage[]> {
  const filenames = (await readdir(contentDirectory, { recursive: true }))
    .filter((filename) => filename.endsWith('.mdx'))
    .toSorted()

  return Promise.all(
    filenames.map(async (filename) => {
      const source = await readFile(path.join(contentDirectory, filename), 'utf8')
      return parsePage(filename.replaceAll(path.sep, '/'), source)
    }),
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
    kind: documentKind(requiredMetadata(metadata, 'kind')),
    sections: await sectionsFromTree(tree),
  }
}

async function sectionsFromTree(root: MdxNode): Promise<readonly DocSection[]> {
  const sections: { id: string; title: string; nodes: MdxNode[] }[] = []
  let current: { id: string; title: string; nodes: MdxNode[] } | undefined

  for (const node of root.children ?? []) {
    if (node.type === 'heading' && node.depth === 2) {
      const title = textOf(node)
      current = { id: slug(title), title, nodes: [] }
      sections.push(current)
    } else if (current !== undefined) {
      current.nodes.push(node)
    }
  }

  return Promise.all(
    sections.map(async (section) => ({
      id: section.id,
      title: section.title,
      blocks: await Promise.all(
        section.nodes.flatMap((node, index) => blockFromNode(node, `${section.id}-${index}`)),
      ),
    })),
  )
}

function blockFromNode(node: MdxNode, key: string): Promise<DocBlock>[] {
  if (node.type === 'paragraph') {
    return [Promise.resolve({ key, text: textOf(node), type: 'paragraph' })]
  }
  if (node.type === 'list') {
    const items = (node.children ?? []).map((item) => textOf(item))
    return [Promise.resolve({ items, key, type: node.ordered ? 'steps' : 'list' })]
  }
  if (node.type === 'code') return [highlightCode(key, node.lang ?? 'text', node.value ?? '')]
  if (node.type === 'table') {
    const rows = (node.children ?? []).map((row, rowIndex) => ({
      key: `${key}-${rowIndex}`,
      cells: (row.children ?? []).map((cell) => textOf(cell)),
    }))
    const [header, ...body] = rows
    return [
      Promise.resolve({
        headers: header?.cells ?? [],
        key,
        rows: body,
        type: 'table',
      }),
    ]
  }
  if (node.type === 'blockquote') {
    const content = textOf(node)
    const match = /^\[!(WARNING|NOTE)\]\s*([^\n]*)(?:\n|\s{2,})([\s\S]*)$/u.exec(content)
    return [
      Promise.resolve({
        key,
        text: match?.[3]?.trim() ?? content,
        title: match?.[2]?.trim() || (match?.[1] === 'WARNING' ? 'Warning' : 'Note'),
        tone: match?.[1] === 'WARNING' ? 'warning' : 'note',
        type: 'callout',
      }),
    ]
  }
  if (node.type === 'mdxJsxFlowElement' && node.name === 'Preview') {
    const variant = attribute(node, 'variant')
    if (variant === 'buttons' || variant === 'cards' || variant === 'counter' || variant === 'switch') {
      return [Promise.resolve({ key, type: 'preview', variant })]
    }
  }
  return []
}

async function highlightCode(key: string, language: string, source: string): Promise<DocBlock> {
  const lang = language === 'shell' ? 'shellscript' : language === 'ts' ? 'typescript' : language
  const highlighted = highlighter.codeToTokens(source, {
    lang: highlighter.getLoadedLanguages().includes(lang) ? lang : 'text',
    theme: 'github-dark',
  })
  return {
    code: source,
    key,
    language,
    lines: highlighted.tokens.map((tokens, lineIndex) => ({
      key: `${key}-${lineIndex}`,
      tokens: tokens.map((token, tokenIndex) => ({
        color: token.color ?? '#f0f6fc',
        content: token.content,
        key: `${key}-${lineIndex}-${tokenIndex}`,
      })),
    })),
    type: 'code',
  }
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
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/gu, '')
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
  return (node.children ?? []).map((child) => textOf(child)).join(node.type === 'blockquote' ? '\n' : '')
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
    value === 'Overview' ||
    value === 'Tutorials' ||
    value === 'How-to guides' ||
    value === 'Reference' ||
    value === 'Explanation'
  ) {
    return value
  }
  throw new Error(`Unknown documentation group ${value}`)
}

function documentKind(value: string): DocumentKind {
  if (
    value === 'Overview' ||
    value === 'Tutorial' ||
    value === 'How-to guide' ||
    value === 'Reference' ||
    value === 'Explanation'
  ) {
    return value
  }
  throw new Error(`Unknown document kind ${value}`)
}
