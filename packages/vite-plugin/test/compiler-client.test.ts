import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { analyzeWithCompiler, compileWithCompiler } from '../src/compiler-client.ts'
import { compilationCacheKey, vidact } from '../src/index.ts'

const packageDirectory = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.resolve(packageDirectory, '../../../Cargo.toml')

type TransformHook = (
  this: { readonly environment: { readonly name: string } },
  source: string,
  id: string,
) => Promise<unknown>

function transformHook(options: Parameters<typeof vidact>[0]): TransformHook {
  const plugin = vidact({ manifestPath, ...options })
  const configure = Reflect.get(plugin, 'configResolved') as (config: { root: string }) => void
  configure({ root: packageDirectory })
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

describe('vidact compiler client', () => {
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
      manifestPath,
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
      manifestPath,
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
      manifestPath,
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
      manifestPath,
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

  it('fingerprints compiler, runtime, target, features, environment, and source inputs', () => {
    const base = {
      source: 'export function App() { return <main /> }',
      filename: '/app/App.tsx',
      manifestPath,
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
    expect(compilationCacheKey(base)).not.toBe(
      compilationCacheKey({ ...base, compilerPath: '/opt/vidact/vidactc' }),
    )
  })

  it('accepts an explicit prebuilt compiler artifact', async () => {
    const compilerPath = path.resolve(packageDirectory, '../../../target/debug/vidactc')
    await expect(
      compileWithCompiler(
        'export function Ready() { return <p>ready</p> }',
        'ready.tsx',
        manifestPath,
        { target: 'client', features: [] },
        { compilerPath },
      ),
    ).resolves.toMatchObject({ protocol: 'vidact-compile-v2' })
  })

  it('rejects invalid modules with the compiler diagnostic', async () => {
    await expect(
      analyzeWithCompiler('export function Broken( {', 'broken.tsx', manifestPath),
    ).rejects.toThrow(/AnalysisFailed/)
  })

  it('requires the unsafe-html feature at the exact JSX attribute', async () => {
    const source = `
      export function Raw() {
        return <section dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }} />
      }
    `

    await expect(compileWithCompiler(source, 'raw.tsx', manifestPath)).rejects.toThrow(
      /raw\.tsx:3:\d+.*unsafe-html/,
    )
    await expect(
      compileWithCompiler(source, 'raw.tsx', manifestPath, {
        target: 'client',
        features: ['unsafe-html'],
      }),
    ).resolves.toMatchObject({
      configuration: { target: 'client', features: ['unsafe-html'] },
    })
  })

  it('compiles only explicitly included dependency source and honors exclusions', async () => {
    const source = 'export function Button() { return <button>ready</button> }'
    const dependencyId = '/app/node_modules/compatible-source/Button.tsx'
    const context = { environment: { name: 'client' } }

    await expect(transformHook({}).call(context, source, dependencyId)).resolves.toBeNull()
    await expect(
      transformHook({ includeDependencies: '**/node_modules/compatible-source/**' }).call(
        context,
        source,
        dependencyId,
      ),
    ).resolves.toMatchObject({ code: expect.stringContaining('__vidactCompiledRoot') })
    await expect(
      transformHook({
        includeDependencies: '**/node_modules/compatible-source/**',
        exclude: '**/Button.tsx',
      }).call(context, source, dependencyId),
    ).resolves.toBeNull()
  })
})
