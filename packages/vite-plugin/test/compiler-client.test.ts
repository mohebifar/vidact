import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { analyzeWithCompiler } from '../src/compiler-client.ts'

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

  it('rejects invalid modules with the compiler diagnostic', async () => {
    await expect(
      analyzeWithCompiler('export function Broken( {', 'broken.tsx', manifestPath),
    ).rejects.toThrow(/AnalysisFailed/)
  })
})
