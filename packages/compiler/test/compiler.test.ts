import { describe, expect, test } from 'vitest'

import { analyze, analyzeSync, compile, compileSync, VidactCompilerError } from '../src/index.ts'

const source = `
  import { useState } from 'react'
  export function Counter() {
    const [count, setCount] = useState(0)
    return <button onClick={() => setCount(count + 1)}>{count}</button>
  }
`

describe('@vidact/compiler', () => {
  test('compiles TSX through the synchronous native API', () => {
    const result = compileSync(source, { filename: '/fixture/Counter.tsx' })

    expect(result.protocol).toBe('vidact-compile-v2')
    expect(result.runtimeProtocol).toBe('vidact-runtime-v2')
    expect(result.configuration).toEqual({ target: 'client', features: [] })
    expect(result.code).toContain('__vidact')
    expect(result.analysis.components[0]?.name).toBe('Counter')
  })

  test('compiles and analyzes TSX without blocking the JavaScript API', async () => {
    const [compilation, analysis] = await Promise.all([
      compile(source, { filename: '/fixture/Counter.tsx' }),
      analyze(source, { filename: '/fixture/Counter.tsx' }),
    ])

    expect(compilation.analysis.protocol).toBe('vidact-analysis-v1')
    expect(analysis.components[0]?.sources.some((entry) => entry.kind === 'state')).toBe(true)
  })

  test('exposes synchronous compiler failures as a stable JavaScript error', () => {
    expect(() =>
      compileSync('export const broken = <', { filename: '/fixture/broken.tsx' }),
    ).toThrow(VidactCompilerError)
    expect(() =>
      analyzeSync('export const broken = <', { filename: '/fixture/broken.tsx' }),
    ).toThrow(VidactCompilerError)
  })

  test('exposes asynchronous compiler failures as a stable JavaScript error', async () => {
    await expect(
      compile('export const broken = <', { filename: '/fixture/broken.tsx' }),
    ).rejects.toBeInstanceOf(VidactCompilerError)
  })
})
