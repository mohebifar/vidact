import { afterEach, describe, expect, it, vi } from 'vitest'

import { readDocs } from '../src/lib/docs-api.server.ts'
import { docsPath } from '../src/lib/docs-path.ts'
import { registerDocsTools, type DocsTool } from '../src/lib/webmcp.ts'

type FetchDocs = (url: string, options: { signal: AbortSignal }) => Promise<Response>
type Navigate = (path: string) => Promise<boolean>

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('documentation WebMCP tools', () => {
  it('registers search, read, and navigation tools with cancellation and cleanup', async () => {
    const registered = new Map<string, DocsTool>()
    const navigate = vi.fn<Navigate>().mockResolvedValue(true)
    const cleanup = registerDocsTools(
      {
        registerTool(tool, { signal }) {
          registered.set(tool.name, tool)
          signal.addEventListener('abort', () => registered.delete(tool.name))
        },
      },
      navigate,
    )
    await Promise.resolve()
    expect([...registered.keys()]).toEqual(['search_docs', 'read_doc', 'open_doc'])
    expect(registered.get('search_docs')!.annotations.readOnlyHint).toBe(true)
    expect(registered.get('open_doc')!.annotations.readOnlyHint).toBe(false)
    const fetcher = vi
      .fn<FetchDocs>()
      .mockResolvedValueOnce(Response.json([{ title: 'State' }]))
      .mockResolvedValueOnce(Response.json({ title: 'State' }))
      .mockResolvedValueOnce(Response.json({ title: 'State' }))
    vi.stubGlobal('fetch', fetcher)
    const context = { signal: new AbortController().signal }
    expect(await registered.get('search_docs')!.execute({ query: 'useState' }, context)).toEqual({
      query: 'useState',
      results: [{ title: 'State' }],
    })
    expect(fetcher.mock.calls[0]![1].signal).toBe(context.signal)
    expect(
      await registered.get('read_doc')!.execute({ path: '/docs/learn/state' }, context),
    ).toEqual({ title: 'State' })
    expect(navigate).not.toHaveBeenCalled()
    await registered.get('open_doc')!.execute({ path: '/docs/learn/state#initial-values' }, context)
    expect(navigate).toHaveBeenCalledWith('/docs/learn/state#initial-values')
    cleanup()
    expect(registered.size).toBe(0)
  })

  it('handles absent support and registration failure without throwing', async () => {
    expect(() => registerDocsTools(undefined, vi.fn<Navigate>())()).not.toThrow()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const register = vi.fn<(tool: DocsTool, options: { signal: AbortSignal }) => AbortSignal>(
      (_tool, { signal }) => {
        if (register.mock.calls.length === 2) throw new Error('unsupported')
        return signal
      },
    )
    const cleanup = registerDocsTools(
      {
        registerTool: (tool, options) => {
          register(tool, options)
        },
      },
      vi.fn<Navigate>(),
    )
    await vi.waitFor(() => expect(warning).toHaveBeenCalled())
    expect(register.mock.calls[0]![1].signal.aborted).toBe(true)
    cleanup()
  })

  it('supports preview browsers that omit the execution signal', async () => {
    const registered: DocsTool[] = []
    const navigate = vi.fn<Navigate>().mockResolvedValue(true)
    const cleanup = registerDocsTools(
      {
        registerTool: (tool) => {
          registered.push(tool)
        },
      },
      navigate,
    )
    await Promise.resolve()
    const fetcher = vi.fn<FetchDocs>().mockResolvedValue(Response.json({ title: 'State' }))
    vi.stubGlobal('fetch', fetcher)
    await registered
      .find((tool) => tool.name === 'open_doc')!
      .execute({ path: '/docs/learn/state' })
    expect(navigate).toHaveBeenCalledWith('/docs/learn/state')
    const signal = fetcher.mock.calls[0]![1].signal
    expect(signal.aborted).toBe(false)
    cleanup()
    expect(signal.aborted).toBe(true)
  })

  it('rejects external and unpublished paths, propagates errors, and honors cancellation', async () => {
    for (const path of [
      'https://evil.test/docs',
      '//evil.test/docs',
      '/docs/../../api/secret',
      '/docs/../x',
      '/docs\\evil',
      '/docs?x=1',
      12,
    ]) {
      expect(() => docsPath(path)).toThrow(/documentation path/u)
    }
    const registered: DocsTool[] = []
    const navigate = vi.fn<Navigate>()
    const cleanup = registerDocsTools(
      {
        registerTool: (tool) => {
          registered.push(tool)
        },
      },
      navigate,
    )
    await Promise.resolve()
    const open = registered.find((tool) => tool.name === 'open_doc')!
    const search = registered.find((tool) => tool.name === 'search_docs')!
    const controller = new AbortController()
    const context = { signal: controller.signal }
    await expect(search.execute({ query: ' ' }, context)).rejects.toThrow('query must contain')
    await expect(search.execute({ query: 1 }, context)).rejects.toThrow('query must be a string')
    vi.stubGlobal(
      'fetch',
      vi
        .fn<FetchDocs>()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(Response.json({ title: 'State' })),
    )
    await expect(open.execute({ path: '/docs/missing' }, context)).rejects.toThrow('not found')
    controller.abort(new Error('cancel docs navigation'))
    await expect(open.execute({ path: '/docs/learn/state' }, context)).rejects.toThrow(
      'cancel docs navigation',
    )
    expect(navigate).not.toHaveBeenCalled()
    cleanup()
  })
})

describe('published documentation reader', () => {
  it('returns sections and code from the content source only', async () => {
    const response = readDocs(new Request('https://example.test/api/docs?path=/docs/learn/state'))
    const page = await response.json()
    expect(page.title).toBe('State')
    expect(page.sections.some((s: { content: string }) => s.content.includes('useState'))).toBe(
      true,
    )
    expect(JSON.stringify(page)).not.toContain('color')
    expect(readDocs(new Request('https://example.test/api/docs?path=/docs/missing')).status).toBe(
      404,
    )
    expect(
      readDocs(new Request('https://example.test/api/docs?path=//evil.test/docs')).status,
    ).toBe(400)
  })
})
