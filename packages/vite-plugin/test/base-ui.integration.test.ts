import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { build, createServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { renderToStaticMarkup } from '../../runtime/src/server.ts'
import { vidact } from '../src/index.ts'

const docsRequire = createRequire(join(import.meta.dirname, '../../../examples/docs/package.json'))
const baseUiRoot = dirname(docsRequire.resolve('@base-ui/react/package.json'))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function transformBaseUiEntry(
  subpath:
    | 'accordion'
    | 'avatar'
    | 'button'
    | 'collapsible'
    | 'input'
    | 'popover'
    | 'switch'
    | 'toggle-group',
  target: 'client' | 'server',
) {
  const entry = join(baseUiRoot, subpath, 'index.mjs')
  const source = await readFile(entry, 'utf8')
  const transform = Reflect.get(
    vidact({ target, features: ['concurrent', 'css-insertion', 'profiling'] }),
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

async function buildBaseUiApp(target: 'client' | 'server', bundleRuntime = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vidact-base-ui-'))
  temporaryDirectories.push(root)
  const entry = join(root, 'src', 'main.tsx')
  await mkdir(dirname(entry), { recursive: true })
  await writeFile(
    entry,
    `
      import { Button } from '@base-ui/react/button'
      import { Avatar } from '@base-ui/react/avatar'
      import { Input } from '@base-ui/react/input'
      import { ToggleGroup } from '@base-ui/react/toggle-group'

      export function App() {
        return <main>
          <Avatar.Root><Avatar.Fallback>VD</Avatar.Fallback></Avatar.Root>
          <Button render={(props) => <a {...props} href="/callback">Callback</a>} />
          <Button render={<a href="/element">Element</a>} />
          <Input aria-label="Search" />
          <ToggleGroup defaultValue={['all']} aria-label="Category" />
        </main>
      }
    `,
  )
  const aliases: Array<{ find: string; replacement: string }> = [
    'avatar',
    'button',
    'input',
    'toggle-group',
  ].map((subpath) => ({
    find: `@base-ui/react/${subpath}`,
    replacement: join(baseUiRoot, subpath, 'index.mjs'),
  }))
  if (bundleRuntime) {
    aliases.push(
      {
        find: '@vidact/runtime/server/jsx-runtime',
        replacement: join(import.meta.dirname, '../../runtime/src/server.ts'),
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
    plugins: [vidact({ target, features: ['concurrent', 'css-insertion', 'profiling'] })],
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

  it('normalizes the published Popover store hook methods for client', async () => {
    const transformed = await transformBaseUiEntry('popover', 'client')

    expect(transformed?.code).toContain('@vidact/runtime')
    expect(transformed?.code).not.toContain('useVidactClassMethod')
    expect(transformed?.code).not.toContain('react/jsx-runtime')
  })

  it('keeps the published Switch memo state reactive after dependency hook expansion', async () => {
    const transformed = await transformBaseUiEntry('switch', 'client')

    expect(transformed?.code).toContain('const state = __vidactCreateMemo')
    expect(transformed?.code).toMatch(
      /SwitchRootContext\.Provider,\s*\{\s*value:\s*__vidactBinding/u,
    )
  })

  it('keeps the published Accordion controlled-state destructuring reactive', async () => {
    const transformed = await transformBaseUiEntry('accordion', 'client')
    const controlledAssignments =
      transformed?.code.match(/controlled\s*=\s*__vidactHook\d+Arg0\["controlled"\]/gu) ?? []

    expect(controlledAssignments.length).toBeGreaterThanOrEqual(2)
    expect(transformed?.code).not.toMatch(/let\s*\{\s*controlled:/u)
  })

  it('serves helper-bearing dependency capsules through the development pipeline', async () => {
    const direct = await transformBaseUiEntry('avatar', 'client')
    expect(direct?.code).not.toContain('\\0rolldown/runtime.js')
    expect(JSON.stringify(direct?.map)).not.toContain('rolldown/runtime.js')

    const server = await createServer({
      root: join(import.meta.dirname, '../../../examples/docs'),
      configFile: false,
      logLevel: 'silent',
      plugins: [vidact({ features: ['concurrent', 'css-insertion', 'profiling'] })],
      resolve: {
        alias: [
          {
            find: '@',
            replacement: join(import.meta.dirname, '../../../examples/docs/src'),
          },
          {
            find: /^@vidact\/runtime\/(.+)$/,
            replacement: `${join(import.meta.dirname, '../../runtime/src')}/$1.ts`,
          },
          {
            find: '@vidact/runtime',
            replacement: join(import.meta.dirname, '../../runtime/src/index.ts'),
          },
        ],
      },
      server: { middlewareMode: true },
    })
    try {
      const result = await server.transformRequest(join(baseUiRoot, 'avatar', 'index.mjs'))

      expect(result?.code).toContain('__vidactCreateState')
      expect(result?.code).not.toContain('react/jsx-runtime')
      expect(result?.code).not.toContain('\\0rolldown/runtime.js')

      const sourceLinked = await server.transformRequest(
        join(import.meta.dirname, '../../../examples/docs/src/components/ui/avatar.tsx'),
      )
      expect(sourceLinked?.code).toContain('__vidactCreateState')
      expect(sourceLinked?.code).not.toContain('react/jsx-runtime')
      expect(sourceLinked?.code).not.toContain('\\0rolldown/runtime.js')

      const sourceEntry = join(
        import.meta.dirname,
        '../../../examples/docs/src/components/ui/avatar.tsx',
      )
      const runtime = await server.pluginContainer.resolveId(
        'vidact:rolldown/runtime.js',
        sourceEntry,
      )
      expect(runtime?.id).toBe('\0vidact:dependency-runtime')
      expect(await server.pluginContainer.load(runtime!.id)).toBe('export {}')
    } finally {
      await server.close()
    }
  })

  for (const target of ['client', 'server'] as const) {
    it(`produces a React-free ${target} bundle`, async () => {
      const code = await buildBaseUiApp(target)

      expect(code).toContain('@vidact/runtime')
      expect(code).not.toMatch(/from\s*["']react(?:-dom)?(?:\/|["'])/)
    })
  }

  it('server-renders Avatar and Button dependency behavior', async () => {
    const code = await buildBaseUiApp('server', true)
    const root = await mkdtemp(join(tmpdir(), 'vidact-base-ui-output-'))
    temporaryDirectories.push(root)
    const output = join(root, 'app.mjs')
    await writeFile(output, code)
    const built = (await import(pathToFileURL(output).href)) as { App(): unknown }
    const html = renderToStaticMarkup(() => built.App() as never)

    expect(html).toContain('VD')
    expect(html).toContain('<a href="/callback" tabIndex="0" type="button">Callback</a>')
    expect(html).toContain('<a href="/element" tabIndex="0" type="button">Element</a>')
    expect(html).toContain('<input aria-label="Search"')
  })
})
