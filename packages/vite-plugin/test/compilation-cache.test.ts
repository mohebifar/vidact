import { describe, expect, it } from 'vitest'

import { ReplacementCache } from '../src/compilation-cache.ts'

describe('replacement compilation cache', () => {
  it('retains only the latest revision for each module configuration', () => {
    const cache = new ReplacementCache<number>()

    for (let revision = 0; revision < 30; revision += 1) {
      cache.set('client:/app/App.tsx', `revision-${revision}`, revision)
    }

    expect(cache.size).toBe(1)
    expect(cache.get('client:/app/App.tsx', 'revision-29')).toBe(29)
    expect(cache.get('client:/app/App.tsx', 'revision-28')).toBeUndefined()
  })

  it('reuses unchanged revisions while isolating configuration slots', () => {
    const cache = new ReplacementCache<object>()
    const clientCompilation = {}
    const hydrateCompilation = {}

    cache.set('client:/app/App.tsx', 'same-source', clientCompilation)
    cache.set('hydrate:/app/App.tsx', 'same-source', hydrateCompilation)

    expect(cache.get('client:/app/App.tsx', 'same-source')).toBe(clientCompilation)
    expect(cache.get('hydrate:/app/App.tsx', 'same-source')).toBe(hydrateCompilation)
    expect(cache.size).toBe(2)
  })
})
