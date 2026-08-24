import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { build } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { renderToStaticMarkup } from '../../runtime/src/server.ts'
import { vidact } from '../src/index.ts'

const shopRequire = createRequire(join(import.meta.dirname, '../../../examples/shop/package.json'))
const baseUiRoot = dirname(shopRequire.resolve('@base-ui/react/package.json'))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function transformBaseUiEntry(
  subpath: 'button' | 'input' | 'toggle-group',
  target: 'client' | 'server',
) {
  const entry = join(baseUiRoot, subpath, 'index.mjs')
  const source = await readFile(entry, 'utf8')
  const transform = Reflect.get(
    vidact({ target, features: ['css-insertion', 'profiling'] }),
    'transform',
  ) as (
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

async function buildBaseUiApp(
  target: 'client' | 'server',
  bundleRuntime = false,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vidact-base-ui-'))
  temporaryDirectories.push(root)
  const entry = join(root, 'src', 'main.tsx')
  await mkdir(dirname(entry), { recursive: true })
  await writeFile(
    entry,
    `
      import { Button } from '@base-ui/react/button'
      import { Input } from '@base-ui/react/input'
      import { ToggleGroup } from '@base-ui/react/toggle-group'

      export function App() {
        return <main>
          <Button render={(props) => <a {...props} href="/callback">Callback</a>} />
          <Button render={<a href="/element">Element</a>} />
          <Input aria-label="Search" />
          <ToggleGroup defaultValue={['all']} aria-label="Category" />
        </main>
      }
    `,
  )
  const aliases: Array<{ find: string; replacement: string }> = ['button', 'input', 'toggle-group'].map((subpath) => ({
    find: `@base-ui/react/${subpath}`,
    replacement: join(baseUiRoot, subpath, 'index.mjs'),
  }))
  if (bundleRuntime) {
    aliases.push(
      {
        find: '@vidact/runtime/profiling/server',
        replacement: join(import.meta.dirname, '../../runtime/src/server-profiling.ts'),
      },
      {
        find: '@vidact/runtime/server/jsx-runtime',
        replacement: join(import.meta.dirname, '../../runtime/src/server-jsx-runtime.ts'),
      },
      {
        find: '@vidact/runtime/server',
        replacement: join(import.meta.dirname, '../../runtime/src/server.ts'),
      },
    )
  }
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [vidact({ target, features: ['css-insertion', 'profiling'] })],
    resolve: { alias: aliases },
    build: {
      write: false,
      lib: { entry, formats: ['es'] },
      ...(bundleRuntime
        ? {}
        : {
            rolldownOptions: {
              external: (specifier: string) => specifier.startsWith('@vidact/runtime'),
            },
          }),
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  return outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n')
}

function generatedPosition(source: string, marker: string): { line: number; column: number } {
  const offset = source.indexOf(marker)
  if (offset === -1) throw new Error(`missing generated marker ${marker}`)
  const before = source.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 }
}

describe('Base UI dependency compilation', () => {
  for (const subpath of ['button', 'input', 'toggle-group'] as const) {
    for (const target of ['client', 'server'] as const) {
      it(`compiles the published ${subpath} entry for ${target}`, async () => {
        const transformed = await transformBaseUiEntry(subpath, target)

        expect(transformed?.code).toContain('@vidact/runtime')
        expect(transformed?.code).not.toContain('react/jsx-runtime')
      })
    }
  }

  it('maps compiled output back to the published package source', async () => {
    const transformed = await transformBaseUiEntry('button', 'client')
    const marker = 'Base UI: Cannot call an event handler while rendering.'
    const original = originalPositionFor(
      new TraceMap(transformed?.map as never),
      generatedPosition(transformed?.code ?? '', marker),
    )

    expect(original.source).toContain('/@base-ui/utils/useStableCallback.mjs')
    expect(original.line).toBe(42)
  })

  for (const target of ['client', 'server'] as const) {
    it(`produces a React-free ${target} bundle`, async () => {
      const code = await buildBaseUiApp(target)

      expect(code).toContain('@vidact/runtime')
      expect(code).not.toMatch(/from\s*["']react(?:-dom)?(?:\/|["'])/)
    })
  }

  it('server-renders callback and element-valued Button render props', async () => {
    const code = await buildBaseUiApp('server', true)
    const root = await mkdtemp(join(tmpdir(), 'vidact-base-ui-output-'))
    temporaryDirectories.push(root)
    const output = join(root, 'app.mjs')
    await writeFile(output, code)
    const built = (await import(pathToFileURL(output).href)) as { App(): unknown }
    const html = renderToStaticMarkup(() => built.App() as never)

    expect(html).toContain('<a href="/callback" tabIndex="0" type="button">Callback</a>')
    expect(html).toContain('<a href="/element" tabIndex="0" type="button">Element</a>')
    expect(html).toContain('<input aria-label="Search"')
  })
})
