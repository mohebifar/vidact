import { compileSync } from '@vidact/compiler'
import { describe, expect, it } from 'vitest'

import { compiledCounter, counterSource } from '../src/lib/landing-samples.ts'

describe('landing compiler output', () => {
  it('matches what the compiler emits for the counter shown on the landing page', () => {
    const output = compileSync(counterSource, {
      features: [],
      filename: 'src/Counter.tsx',
      target: 'client',
    })

    expect(output.code.trimEnd()).toBe(compiledCounter)
  })
})
