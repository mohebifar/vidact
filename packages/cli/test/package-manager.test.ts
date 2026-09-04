import { describe, expect, it } from 'vitest'

import { packageManagerFromUserAgent } from '../src/package-manager.ts'

describe('package managers', () => {
  it.each([
    ['pnpm/10.19.0 npm/? node/v24.0.0 darwin arm64', 'pnpm'],
    ['yarn/4.1.0 npm/? node/v24.0.0 darwin arm64', 'yarn'],
    ['bun/1.1.0', 'bun'],
    ['deno/2.0.0', 'deno'],
  ])('reads %s as %s', (userAgent, expected) => {
    expect(packageManagerFromUserAgent(userAgent)).toBe(expected)
  })

  it.each(['', 'cnpm/9.0.0'])('ignores an unusable user agent (%s)', (userAgent) => {
    expect(packageManagerFromUserAgent(userAgent)).toBeUndefined()
  })
})
