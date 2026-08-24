import { describe, expect, it } from 'vitest'

import { analyzeWithCompiler, compileWithCompiler } from '../src/compiler-client.ts'
import { compilationCacheKey, vidact } from '../src/index.ts'

type TransformHook = (
  this: { readonly environment: { readonly name: string } },
  source: string,
  id: string,
) => Promise<unknown>

function transformHook(options: Parameters<typeof vidact>[0]): TransformHook {
  const plugin = vidact(options)
  return Reflect.get(plugin, 'transform') as TransformHook
}

function virtualReactModule(options: Parameters<typeof vidact>[0]): string {
  const plugin = vidact(options)
  const resolve = Reflect.get(plugin, 'resolveId') as (source: string) => string | null
  const load = Reflect.get(plugin, 'load') as (id: string) => string | null
  return load(resolve('react')!)!
}

function virtualReactDomModule(options: Parameters<typeof vidact>[0]): string {
  const plugin = vidact(options)
  const resolve = Reflect.get(plugin, 'resolveId') as (source: string) => string | null
  const load = Reflect.get(plugin, 'load') as (id: string) => string | null
  return load(resolve('react-dom')!)!
}

function virtualModule(source: string, options: Parameters<typeof vidact>[0]): string {
  const plugin = vidact(options)
  const resolve = Reflect.get(plugin, 'resolveId') as (specifier: string) => string | null
  const load = Reflect.get(plugin, 'load') as (id: string) => string | null
  return load(resolve(source)!)!
}

describe('vidact compiler client', () => {
  it('rejects removed compiler process options with a migration error', () => {
    expect(() => vidact({ compilerPath: '/tmp/vidactc' } as never)).toThrow(
      '`compilerPath` and `manifestPath` were removed; install @vidact/compiler for the current platform',
    )
    expect(() => vidact({ manifestPath: '/tmp/Cargo.toml' } as never)).toThrow(
      '`compilerPath` and `manifestPath` were removed; install @vidact/compiler for the current platform',
    )
  })

  it('returns the Rust compiler analysis protocol for TSX arrays', async () => {
    const analysis = await analyzeWithCompiler(
      `
        import { useState } from 'react'
        export function Todos() {
          const [items] = useState([{ id: 1, label: 'one' }])
          return <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
        }
      `,
      'todos.tsx',
    )

    expect(analysis.protocol).toBe('vidact-analysis-v1')
    expect(analysis.components).toHaveLength(1)
    expect(analysis.components[0]?.name).toBe('Todos')
    expect(analysis.components[0]?.updaters).toContainEqual(
      expect.objectContaining({ kind: 'keyed-list' }),
    )
  })

  it('returns Rust-generated surgical bindings for a stateful keyed component', async () => {
    const compilation = await compileWithCompiler(
      `
        import { useState } from 'react'
        export function Todos(): Node {
          const [items, setItems] = useState([{ id: 1, label: 'one' }])
          return <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
        }
      `,
      'todos.tsx',
    )

    expect(compilation.protocol).toBe('vidact-compile-v2')
    expect(compilation.analysis.components[0]?.name).toBe('Todos')
    expect(compilation.code).toContain('createCompiledState')
    expect(compilation.code).toContain('__vidactCompiledRoot(')
    expect(compilation.code).toContain('__vidactKeyed(')
    expect(compilation.code).not.toContain('useState')
    expect(compilation.code).not.toContain('async ()')
    expect(compilation).toHaveProperty('sourceMap')
    const sourceMap = (compilation as unknown as { sourceMap: { sources: string[] } }).sourceMap
    expect(sourceMap.sources).toContain('todos.tsx')
    expect(compilation.runtimeProtocol).toBe('vidact-runtime-v1')
    expect(compilation.configuration).toEqual({ target: 'client', features: [] })
  })

  it('returns deterministic server code without client effect replay', async () => {
    const compilation = await compileWithCompiler(
      `
        import { useEffect, useMemo, useState } from 'react'
        export function Greeting({ name }: { name: string }) {
          const [count] = useState(() => 2)
          const label = useMemo(() => name + count, [name, count])
          useEffect(() => console.log(label), [label])
          return <p>{label}</p>
        }
      `,
      'greeting.tsx',
      { target: 'server', features: [] },
    )

    expect(compilation.configuration).toEqual({ target: 'server', features: [] })
    expect(compilation.analysis.components[0]?.name).toBe('Greeting')
    expect(compilation.code).toContain('useState(')
    expect(compilation.code).not.toContain('useEffect(')
    expect(compilation.code).not.toContain('useMemo(')
    expect(compilation.code).not.toContain('__vidactCompiledRoot')
  })

  it('routes hydration builds through the isolated hydration runtime entry', async () => {
    const compilation = await compileWithCompiler(
      `
        import { useState } from 'react'
        export function Counter() {
          const [count, setCount] = useState(0)
          return <button onClick={() => setCount(count + 1)}>{count}</button>
        }
      `,
      'counter.tsx',
      { target: 'hydrate', features: [] },
    )

    expect(compilation.configuration.target).toBe('hydrate')
    expect(compilation.code).toContain('from "@vidact/runtime/hydrate"')
    expect(compilation.code).not.toContain('from "@vidact/runtime"')
  })

  it('selects isolated async React facades for every compiler target', () => {
    expect(virtualReactModule({ features: ['async'] })).toContain('@vidact/runtime/async"')
    expect(virtualReactModule({ target: 'hydrate', features: ['async'] })).toContain(
      '@vidact/runtime/async/hydrate',
    )
    expect(virtualReactModule({ target: 'server', features: ['async'] })).toContain(
      '@vidact/runtime/async/server',
    )
    expect(virtualReactModule({ features: ['async'] })).toContain('Suspense, lazy')
    expect(virtualReactModule({})).not.toContain('Suspense, lazy')
  })

  it('selects isolated concurrent facades and exposes scheduler APIs only when enabled', () => {
    expect(virtualReactModule({ features: ['concurrent'] })).toContain('@vidact/runtime/concurrent')
    expect(virtualReactModule({ target: 'hydrate', features: ['concurrent'] })).toContain(
      '@vidact/runtime/concurrent/hydrate',
    )
    expect(virtualReactModule({ target: 'server', features: ['concurrent'] })).toContain(
      '@vidact/runtime/concurrent/server',
    )
    expect(virtualReactModule({ features: ['async', 'concurrent'] })).toContain(
      '@vidact/runtime/async/concurrent',
    )
    expect(virtualReactModule({ features: ['concurrent'] })).toContain(
      'startTransition, useDeferredValue, useTransition',
    )
    expect(virtualReactModule({})).not.toContain('startTransition')
    expect(virtualReactDomModule({ features: ['concurrent'] })).toContain('flushSync')
    expect(virtualReactDomModule({})).not.toContain('flushSync')
  })

  it('exposes Activity only through retained-ui target-specific facades', () => {
    expect(virtualReactModule({ features: ['retained-ui'] })).toContain(
      'export { Activity } from "@vidact/runtime/retained-ui"',
    )
    expect(virtualReactModule({ target: 'hydrate', features: ['retained-ui'] })).toContain(
      '@vidact/runtime/retained-ui/hydrate',
    )
    expect(virtualReactModule({ target: 'server', features: ['retained-ui'] })).toContain(
      '@vidact/runtime/retained-ui/server',
    )
    expect(virtualReactModule({})).not.toContain('Activity')
  })

  it('exposes development profiling only through target-specific facades', () => {
    expect(virtualReactModule({ features: ['profiling'] })).toContain(
      'export { Profiler, captureOwnerStack, useDebugValue } from "@vidact/runtime/profiling"',
    )
    expect(virtualReactModule({ target: 'hydrate', features: ['profiling'] })).toContain(
      '@vidact/runtime/profiling/hydrate',
    )
    expect(virtualReactModule({ target: 'server', features: ['profiling'] })).toContain(
      '@vidact/runtime/profiling/server',
    )
    expect(virtualReactModule({})).not.toContain('captureOwnerStack')
  })

  it('exposes server strings by target and framework caches, hints, streams, and static rendering by feature', () => {
    expect(virtualReactModule({ target: 'server', features: ['framework'] })).toContain(
      'cache, cacheSignal',
    )
    expect(virtualReactModule({ target: 'server', features: ['framework'] })).toContain(
      '@vidact/runtime/framework/server',
    )
    expect(virtualReactDomModule({ features: ['framework'] })).toContain(
      'preconnect, prefetchDNS, preinit, preinitModule, preload, preloadModule',
    )
    expect(virtualReactDomModule({ target: 'hydrate', features: ['framework'] })).toContain(
      '@vidact/runtime/framework/hydrate',
    )
    expect(virtualReactDomModule({})).not.toContain('preconnect')
    expect(
      virtualModule('react-dom/server', { target: 'server', features: ['framework'] }),
    ).toContain('renderToPipeableStream, renderToReadableStream, resume, resumeToPipeableStream')
    expect(
      virtualModule('react-dom/static', { target: 'server', features: ['framework'] }),
    ).toContain('prerender, prerenderToNodeStream')
    expect(virtualModule('react-dom/server', { target: 'server' })).toContain(
      'renderToStaticMarkup, renderToString',
    )
    expect(virtualModule('react-dom/server', {})).toContain('requires the server target')
  })

  it('selects isolated Actions facades and exposes form APIs only when enabled', () => {
    expect(virtualReactModule({ features: ['actions'] })).toContain('@vidact/runtime/actions"')
    expect(virtualReactModule({ target: 'hydrate', features: ['actions'] })).toContain(
      '@vidact/runtime/actions/hydrate',
    )
    expect(virtualReactModule({ target: 'server', features: ['actions'] })).toContain(
      '@vidact/runtime/actions/server',
    )
    expect(virtualReactModule({ features: ['async', 'actions'] })).toContain(
      '@vidact/runtime/async/actions',
    )
    expect(virtualReactModule({ features: ['actions'] })).toContain('useActionState, useOptimistic')
    expect(virtualReactModule({ features: ['actions'] })).not.toContain('startTransition')
    expect(virtualReactModule({})).not.toContain('useActionState')
    expect(virtualReactDomModule({ features: ['actions'] })).toContain('useFormStatus')
    expect(virtualReactDomModule({})).not.toContain('useFormStatus')
  })

  it('fingerprints compiler, runtime, target, features, environment, and source inputs', () => {
    const base = {
      source: 'export function App() { return <main /> }',
      filename: '/app/App.tsx',
      target: 'client' as const,
      features: ['profiling', 'async'] as const,
      environment: 'client',
    }

    expect(compilationCacheKey(base)).toBe(
      compilationCacheKey({ ...base, features: ['async', 'profiling'] }),
    )
    expect(compilationCacheKey(base)).not.toBe(compilationCacheKey({ ...base, target: 'hydrate' }))
    expect(compilationCacheKey(base)).not.toBe(compilationCacheKey({ ...base, environment: 'ssr' }))
    expect(compilationCacheKey(base)).not.toBe(
      compilationCacheKey({ ...base, source: `${base.source}\n` }),
    )
  })

  it('rejects invalid modules with the compiler diagnostic', async () => {
    await expect(analyzeWithCompiler('export function Broken( {', 'broken.tsx')).rejects.toThrow(
      /AnalysisFailed/,
    )
  })

  it('requires the unsafe-html feature at the exact JSX attribute', async () => {
    const source = `
      export function Raw() {
        return <section dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }} />
      }
    `

    await expect(compileWithCompiler(source, 'raw.tsx')).rejects.toThrow(
      /raw\.tsx:3:\d+.*unsafe-html/,
    )
    await expect(
      compileWithCompiler(source, 'raw.tsx', {
        target: 'client',
        features: ['unsafe-html'],
      }),
    ).resolves.toMatchObject({
      configuration: { target: 'client', features: ['unsafe-html'] },
    })
  })

  it('compiles pre-transformed MDX when the extension is enabled', async () => {
    const source = `
      export default function Article() {
        return <article><h1>Compiled MDX</h1><p>Direct DOM documentation.</p></article>
      }
    `
    const context = { environment: { name: 'client' } }

    await expect(transformHook({}).call(context, source, '/app/guide.mdx')).resolves.toBeNull()
    await expect(
      transformHook({ extensions: ['.tsx', '.mdx'] }).call(
        context,
        source,
        '/app/guide.mdx?import',
      ),
    ).resolves.toMatchObject({ code: expect.stringContaining('__vidactCompiledRoot') })
  })
})
