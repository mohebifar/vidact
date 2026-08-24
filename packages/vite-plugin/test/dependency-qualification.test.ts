import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DependencyQualificationError,
  createDependencyQualifier,
  isDependencyModuleId,
} from '../src/dependency-qualification.ts'
import { vidact } from '../src/index.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vidact-dependency-qualification-'))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'fixture-app' }))
  return directory
}

async function packageModule(
  root: string,
  packagePath: string,
  manifest: Record<string, unknown> | string,
): Promise<string> {
  const packageRoot = join(root, 'node_modules', ...packagePath.split('/'))
  const modulePath = join(packageRoot, 'dist', 'index.mjs')
  await mkdir(dirname(modulePath), { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
  )
  await writeFile(modulePath, 'export const fixture = true')
  return modulePath
}

function transformHook(
  options: Parameters<typeof vidact>[0] = {},
  environment = 'client',
): (source: string, id: string) => Promise<unknown> {
  const transform = Reflect.get(vidact(options), 'transform') as (
    this: {
      readonly environment: { readonly name: string }
      addWatchFile(filename: string): void
    },
    source: string,
    id: string,
  ) => Promise<unknown>
  return transform.bind({ environment: { name: environment }, addWatchFile() {} })
}

describe('dependency qualification', () => {
  it('ignores Vite implementation caches nested under node_modules', async () => {
    expect(isDependencyModuleId('/app/node_modules/.vite-temp/config.mjs')).toBe(false)
    await expect(
      createDependencyQualifier().qualify('/app/node_modules/.vite-temp/config.mjs'),
    ).resolves.toBeNull()
  })

  it.each([
    ['peer dependency', { peerDependencies: { react: '^19.0.0' } }],
    ['ordinary dependency', { dependencies: { react: '^19.0.0' } }],
    ['React DOM dependency', { dependencies: { 'react-dom': '^19.0.0' } }],
    ['optional dependency', { optionalDependencies: { react: '^19.0.0' } }],
    [
      'optional peer dependency',
      {
        peerDependencies: { react: '^19.0.0' },
        peerDependenciesMeta: { react: { optional: true } },
      },
    ],
  ])('qualifies a package with React in %s metadata', async (_label, metadata) => {
    const root = await temporaryProject()
    const modulePath = await packageModule(root, 'candidate', {
      name: 'candidate',
      version: '1.2.3',
      ...metadata,
    })

    const qualification = await createDependencyQualifier().qualify(modulePath)

    expect(qualification).toMatchObject({
      status: 'candidate',
      packageName: 'candidate',
      packageVersion: '1.2.3',
      reason: 'react-metadata',
    })
  })

  it('leaves a reachable non-React package on the ordinary build path', async () => {
    const root = await temporaryProject()
    const modulePath = await packageModule(root, 'ordinary', {
      name: 'ordinary',
      version: '1.0.0',
      dependencies: { nanoid: '^5.0.0' },
    })

    await expect(createDependencyQualifier().qualify(modulePath)).resolves.toMatchObject({
      status: 'ordinary',
      packageName: 'ordinary',
      reason: 'no-react-metadata',
    })
  })

  it('automatically compiles only reachable React candidates in the transform hook', async () => {
    const root = await temporaryProject()
    const candidate = await packageModule(root, 'candidate', {
      name: 'candidate',
      peerDependencies: { react: '^19.0.0' },
    })
    const ordinary = await packageModule(root, 'ordinary', {
      name: 'ordinary',
      dependencies: { nanoid: '^5.0.0' },
    })
    const transform = transformHook()
    const serverTransform = transformHook({ target: 'server' }, 'ssr')
    const source = 'export function Button() { return <button>Save</button> }'
    const candidateTsx = candidate.replace(/\.mjs$/, '.tsx')
    const ordinaryTsx = ordinary.replace(/\.mjs$/, '.tsx')
    await Promise.all([writeFile(candidateTsx, source), writeFile(ordinaryTsx, source)])

    await expect(transform(source, candidateTsx)).resolves.not.toBeNull()
    await expect(serverTransform(source, candidateTsx)).resolves.not.toBeNull()
    await expect(transform(source, ordinaryTsx)).resolves.toBeNull()
    await expect(
      transformHook({ includeDependencies: '**/node_modules/ordinary/**' })(source, ordinaryTsx),
    ).resolves.not.toBeNull()
    await expect(
      transformHook({
        includeDependencies: '**/node_modules/ordinary/**',
        exclude: '**/index.tsx',
      })(source, ordinaryTsx),
    ).resolves.toBeNull()
  })

  it('resolves scoped pnpm paths and linked packages to stable identities', async () => {
    const root = await temporaryProject()
    const pnpmPackageRoot = join(
      root,
      'node_modules',
      '.pnpm',
      '@scope+button@1.2.3',
      'node_modules',
      '@scope',
      'button',
    )
    const pnpmModule = join(pnpmPackageRoot, 'dist', 'index.mjs')
    await mkdir(dirname(pnpmModule), { recursive: true })
    await writeFile(
      join(pnpmPackageRoot, 'package.json'),
      JSON.stringify({
        name: '@scope/button',
        version: '1.2.3',
        peerDependencies: { react: '^19.0.0' },
      }),
    )
    await writeFile(pnpmModule, 'export const fixture = true')

    const linkedSourceRoot = join(root, 'packages', 'linked-button')
    const linkedModule = join(linkedSourceRoot, 'dist', 'index.mjs')
    await mkdir(dirname(linkedModule), { recursive: true })
    await writeFile(
      join(linkedSourceRoot, 'package.json'),
      JSON.stringify({
        name: 'linked-button',
        version: '2.0.0',
        dependencies: { react: '^19.0.0' },
      }),
    )
    await writeFile(linkedModule, 'export const fixture = true')
    const linkedInstall = join(root, 'node_modules', 'linked-button')
    await symlink(linkedSourceRoot, linkedInstall, 'dir')

    const qualifier = createDependencyQualifier()
    const [pnpm, linked] = await Promise.all([
      qualifier.qualify(pnpmModule),
      qualifier.qualify(join(linkedInstall, 'dist', 'index.mjs')),
    ])

    expect(pnpm).toMatchObject({
      status: 'candidate',
      packageName: '@scope/button',
      packageVersion: '1.2.3',
    })
    expect(linked).toMatchObject({
      status: 'candidate',
      packageName: 'linked-button',
      packageVersion: '2.0.0',
      packageRoot: await realpath(linkedSourceRoot),
    })
  })

  it('uses include as a discovery override and lets exclusion win', async () => {
    const root = await temporaryProject()
    const modulePath = await packageModule(root, 'ordinary', {
      name: 'ordinary',
      version: '1.0.0',
    })
    const qualifier = createDependencyQualifier()

    await expect(qualifier.qualify(modulePath, { includeOverride: true })).resolves.toMatchObject({
      status: 'candidate',
      reason: 'include-override',
    })
    await expect(
      qualifier.qualify(modulePath, { excludeOverride: true, includeOverride: true }),
    ).resolves.toMatchObject({ status: 'excluded', reason: 'exclude-override' })
  })

  it('reports malformed owning manifests with package identity', async () => {
    const root = await temporaryProject()
    const modulePath = await packageModule(root, 'broken-package', '{')

    await expect(createDependencyQualifier().qualify(modulePath)).rejects.toEqual(
      expect.objectContaining<Partial<DependencyQualificationError>>({
        name: 'DependencyQualificationError',
        packageName: 'broken-package',
        modulePath,
      }),
    )
  })

  it('reports a missing owning manifest instead of guessing from the app manifest', async () => {
    const root = await temporaryProject()
    const modulePath = join(root, 'node_modules', 'missing-manifest', 'dist', 'index.mjs')
    await mkdir(dirname(modulePath), { recursive: true })
    await writeFile(modulePath, 'export const fixture = true')

    await expect(createDependencyQualifier().qualify(modulePath)).rejects.toMatchObject({
      name: 'DependencyQualificationError',
      packageName: 'missing-manifest',
      modulePath,
    })
  })

  it('adds package, version, entry, and target context to semantic rejection', async () => {
    const root = await temporaryProject()
    const modulePath = await packageModule(root, 'opaque-react-package', {
      name: 'opaque-react-package',
      version: '4.5.6',
      peerDependencies: { react: '^19.0.0' },
    })
    const source = `
      import { jsx } from 'react/jsx-runtime'
      const lost = jsx
      export function Broken() { return lost('main', { children: 'opaque' }) }
    `
    await writeFile(modulePath, source)

    await expect(transformHook({ target: 'server' }, 'ssr')(source, modulePath)).rejects.toThrow(
      new RegExp(
        `Cannot compile React dependency opaque-react-package@4\\.5\\.6 for server from .*index\\.mjs:.*provenance`,
      ),
    )
  })
})
