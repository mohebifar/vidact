import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { vidact } from '../src/index.ts'

// lucide-react is a devDependency of this package, so the suite resolves it
// itself rather than through whatever an example app happens to install.
const testRequire = createRequire(import.meta.url)
const lucideRoot = dirname(testRequire.resolve('lucide-react/package.json'))

async function transformLucideIcon(icon: string, target: 'client' | 'server') {
  const entry = join(lucideRoot, 'dist', 'esm', 'icons', `${icon}.mjs`)
  const source = await readFile(entry, 'utf8')
  const transform = Reflect.get(vidact({ target, features: ['css-insertion'] }), 'transform') as (
    this: {
      readonly environment: { readonly name: string }
      addWatchFile(filename: string): void
    },
    source: string,
    id: string,
  ) => Promise<{
    readonly code: string
    readonly map?: Record<string, unknown>
  } | null>

  return transform.call(
    {
      environment: { name: target === 'server' ? 'ssr' : 'client' },
      addWatchFile() {},
    },
    source,
    entry,
  )
}

describe('lucide-react dependency compilation', () => {
  it.each(['client', 'server'] as const)(
    'compiles a published icon module for %s without shims',
    async (target) => {
      const transformed = await transformLucideIcon('arrow-right', target)

      // The published factory keeps its inner component, compiled in place.
      expect(transformed?.code).toContain('createLucideIcon')
      expect(transformed?.code).toContain('@vidact/runtime')
      expect(transformed?.code).not.toContain('forwardRef')
      // The icon path data survives into the capsule.
      expect(transformed?.code).toContain('M5 12h14')
    },
  )

  it('renders the dynamic SVG tag through a runtime element call', async () => {
    const transformed = await transformLucideIcon('arrow-right', 'client')

    // Icon's `createElement(name, ...)` root must stay a runtime call: JSX
    // name position would reinterpret the identifier as a literal tag.
    expect(transformed?.code).toContain('__vidactCreateReactElement')
    expect(transformed?.code).not.toContain('<name')
  })

  it('keeps the destructured icon build results reactive', async () => {
    const transformed = await transformLucideIcon('circle-alert', 'client')

    // `const [name, svgAttributes, builtIconNode = []] = buildLucideIconForReact(...)`
    // compiles into per-element derived locals.
    expect(transformed?.code).toContain('svgAttributes')
    expect(transformed?.code).toContain('builtIconNode')
    expect(transformed?.code).toContain('__vidactCompiledRoot')
  })
})
