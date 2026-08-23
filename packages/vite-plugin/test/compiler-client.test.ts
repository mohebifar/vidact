import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { analyzeWithCompiler, compileWithCompiler } from '../src/compiler-client.ts'
import { compilationCacheKey } from '../src/index.ts'

const packageDirectory = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.resolve(packageDirectory, '../../../Cargo.toml')

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
  })

  it('rejects invalid modules with the compiler diagnostic', async () => {
    await expect(
      analyzeWithCompiler('export function Broken( {', 'broken.tsx', manifestPath),
    ).rejects.toThrow(/AnalysisFailed/)
  })
})
