import type { DocBlock, DocInline, DocSection } from './docs-types.ts'

export function inlineText(nodes: readonly DocInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'break') return '\n'
      if ('value' in node) return node.value
      return node.children.map((child) => child.value).join('')
    })
    .join('')
}

export function blockText(block: DocBlock): string {
  switch (block.type) {
    case 'paragraph':
      return inlineText(block.content)
    case 'heading':
      return block.text
    case 'code':
      return block.code
    case 'list':
      return block.items.map((item) => inlineText(item.content)).join('\n')
    case 'callout':
      return [block.title, ...block.paragraphs.map((p) => inlineText(p.content))].join('\n')
    case 'table':
      return [
        block.headers.map((cell) => inlineText(cell.content)).join(' | '),
        ...block.rows.map((row) => row.cells.map((cell) => inlineText(cell.content)).join(' | ')),
      ].join('\n')
    case 'preview':
      return ''
  }
}

/** Reuse rendered heading IDs so search links land on the matching section. */
export function searchStructure(sections: readonly DocSection[]) {
  const headings: { id: string; content: string }[] = []
  const contents: { heading: string | undefined; content: string }[] = []
  for (const section of sections) {
    let heading = section.id || undefined
    if (heading) headings.push({ id: heading, content: section.title })
    for (const block of section.blocks) {
      if (block.type === 'heading') {
        heading = block.id
        headings.push({ id: heading, content: block.text })
      } else {
        const content = blockText(block)
        if (content) contents.push({ heading, content })
      }
    }
  }
  return { headings, contents }
}
