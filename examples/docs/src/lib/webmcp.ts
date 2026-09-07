import { docsPath } from './docs-path.ts'
import { MAX_SEARCH_LENGTH } from './search-types.ts'
import { fetchDocsSearch } from './search.ts'

// The experimental browser API is not yet in TypeScript's DOM library.
// https://developer.chrome.com/docs/ai/webmcp/imperative-api
export interface DocsTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations: { readonly readOnlyHint: boolean }
  readonly execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>
}

export interface DocsModelContext {
  registerTool(tool: DocsTool, options: { signal: AbortSignal }): void | Promise<void>
}

type Navigate = (path: string) => Promise<boolean>

export function registerDocsTools(
  context: DocsModelContext | undefined,
  navigate: Navigate,
): () => void {
  if (!context || typeof context.registerTool !== 'function') return () => {}
  const registration = new AbortController()
  const tools: DocsTool[] = [
    {
      name: 'search_docs',
      description:
        'Search the Vidact documentation for APIs, guides, and code examples. Returns page titles, matching text, and local paths with heading anchors. Use read_doc to read a result.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_SEARCH_LENGTH,
            description: 'API name or topic, such as useState or server rendering.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input, { signal = registration.signal } = {}) => {
        const query = field(input, 'query').trim()
        if (!query || query.length > MAX_SEARCH_LENGTH)
          throw new TypeError(`query must contain 1–${MAX_SEARCH_LENGTH} characters.`)
        return { query, results: await fetchDocsSearch(query, signal) }
      },
    },
    {
      name: 'read_doc',
      description:
        'Read a published Vidact documentation page, including its code examples. Pass a local /docs path from search_docs. Returns title, description, and section text without changing the current page.',
      inputSchema: pathSchema(),
      annotations: { readOnlyHint: true },
      execute: async (input, { signal = registration.signal } = {}) =>
        readDoc(docsPath(field(input, 'path')), signal),
    },
    {
      name: 'open_doc',
      description:
        'Open a Vidact documentation page in this tab. Pass a local /docs path, optionally with a heading anchor, from search_docs. Changes the visible page and browser history.',
      inputSchema: pathSchema(),
      annotations: { readOnlyHint: false },
      execute: async (input, { signal = registration.signal } = {}) => {
        const path = docsPath(field(input, 'path'))
        await readDoc(path, signal)
        signal.throwIfAborted()
        if (!(await navigate(path))) throw new Error('Navigation did not complete. Try again.')
        return { url: path }
      },
    },
  ]

  // Failed or unsupported registration must not prevent site hydration.
  void Promise.all(
    tools.map((tool) =>
      Promise.resolve().then(() => {
        if (!registration.signal.aborted)
          return context.registerTool(tool, { signal: registration.signal })
      }),
    ),
  ).catch((error: unknown) => {
    registration.abort()
    console.warn('Vidact docs WebMCP registration failed.', error)
  })
  return () => registration.abort()
}

function pathSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        maxLength: 500,
        pattern: '^/docs(?:/|#|$)',
        description: 'Local documentation path, for example /docs/learn/state#initial-values.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  }
}

function field(input: unknown, name: string): string {
  if (typeof input !== 'object' || input === null || !(name in input))
    throw new TypeError(`Missing ${name}.`)
  const value = (input as Record<string, unknown>)[name]
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`)
  return value
}

async function readDoc(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/docs?${new URLSearchParams({ path })}`, { signal })
  if (response.status === 404)
    throw new Error('Documentation page not found. Use search_docs to find a published page.')
  if (!response.ok) throw new Error('Could not read the documentation. Try again.')
  return response.json()
}
