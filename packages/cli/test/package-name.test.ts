import { describe, expect, it } from 'vitest'

import { isValidPackageName, toPackageName } from '../src/package-name.ts'

describe('package names', () => {
  it.each(['my-app', '@scope/my-app', 'app.v2', 'a'])('accepts %s', (name) => {
    expect(isValidPackageName(name)).toBe(true)
  })

  it.each(['My App', '', '.hidden', '_private', 'a'.repeat(215)])('rejects %s', (name) => {
    expect(isValidPackageName(name)).toBe(false)
  })

  it.each([
    ['My App', 'my-app'],
    ['  Spaced  Name ', 'spaced-name'],
    ['.hidden', 'hidden'],
    ['???', 'vidact-app'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(toPackageName(input)).toBe(expected)
  })
})
