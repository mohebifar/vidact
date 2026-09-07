import { blockText } from './docs-content.ts'
import { docsPath } from './docs-path.ts'
import { source } from './source.server.ts'

const pages = new Map(source.getPages().map((page) => [page.url, page]))

export function readDocs(request: Request): Response {
  let path: string
  try {
    path = docsPath(new URL(request.url).searchParams.get('path'))
  } catch {
    return Response.json({ error: 'Use a local /docs path.' }, { status: 400 })
  }
  const page = pages.get(path.split('#')[0]!)
  if (!page) return Response.json({ error: 'Documentation page not found.' }, { status: 404 })
  return Response.json({
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    group: page.data.group,
    sections: page.data.sections.map((section) => ({
      id: section.id,
      title: section.title,
      content: section.blocks.map(blockText).filter(Boolean).join('\n\n'),
    })),
  })
}
