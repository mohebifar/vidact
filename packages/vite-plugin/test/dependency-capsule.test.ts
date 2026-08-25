import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { build, createServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { compileWithCompiler } from '../src/compiler-client.ts'
import {
  buildDependencyCapsule,
  createDependencyCapsuleBuilder,
  type DependencyCapsuleInput,
} from '../src/dependency-capsule.ts'
import { createDependencyQualifier } from '../src/dependency-qualification.ts'
import { vidact } from '../src/index.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function capsuleFixture(): Promise<{
  readonly input: DependencyCapsuleInput
  readonly root: string
  readonly entry: string
  readonly hook: string
  readonly hookManifest: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'vidact-dependency-capsule-'))
  temporaryDirectories.push(root)
  const packageRoot = join(root, 'node_modules', 'capsule-button')
  const entry = join(packageRoot, 'dist', 'index.mjs')
  const button = join(packageRoot, 'dist', 'button.mjs')
  const hookPackageRoot = join(root, 'node_modules', 'capsule-hooks')
  const utilityPackageRoot = join(root, 'node_modules', 'plain-helper')
  const hook = join(hookPackageRoot, 'dist', 'use-label.mjs')
  const hookManifest = join(hookPackageRoot, 'package.json')
  await mkdir(dirname(entry), { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'capsule-button',
      version: '1.2.3',
      type: 'module',
      peerDependencies: { react: '^19.0.0' },
    }),
  )
  await writeFile(entry, `export { Button } from './button.mjs'`)
  await mkdir(dirname(hook), { recursive: true })
  await writeFile(
    hookManifest,
    JSON.stringify({
      name: 'capsule-hooks',
      version: '2.0.0',
      type: 'module',
      exports: './dist/use-label.mjs',
      peerDependencies: { react: '^19.0.0' },
    }),
  )
  await mkdir(utilityPackageRoot, { recursive: true })
  await writeFile(
    join(utilityPackageRoot, 'package.json'),
    JSON.stringify({ name: 'plain-helper', version: '1.0.0', exports: './index.mjs' }),
  )
  await writeFile(join(utilityPackageRoot, 'index.mjs'), `export const format = (value) => value`)
  await writeFile(
    button,
    `
      import { jsx as h } from 'react/jsx-runtime'
      import { useLabel } from 'capsule-hooks'
      import { format } from 'plain-helper'
      export function Button() {
        const { label, setLabel } = useLabel()
        return h('button', {
          'data-mode': process.env.NODE_ENV,
          onClick: () => setLabel(label),
          children: format(label),
        })
      }
    `,
  )
  await writeFile(
    hook,
    `
      import { useState as s } from 'react'
      export function useLabel() {
        const [label, setLabel] = s('Save')
        return { label, setLabel }
      }
    `,
  )
  const qualification = await createDependencyQualifier().qualify(entry)
  if (
    qualification?.status !== 'candidate' ||
    qualification.realModulePath === undefined ||
    qualification.manifestPath === undefined ||
    qualification.packageRoot === undefined ||
    qualification.packageName === undefined
  ) {
    throw new Error('fixture package did not qualify')
  }
  return {
    root,
    entry,
    hook,
    hookManifest,
    input: {
      source: await readFile(entry, 'utf8'),
      environment: 'client',
      target: 'client',
      features: [],
      defines: { 'process.env.NODE_ENV': JSON.stringify('production') },
      qualification: {
        ...qualification,
        status: 'candidate',
        realModulePath: qualification.realModulePath,
        manifestPath: qualification.manifestPath,
        packageRoot: qualification.packageRoot,
        packageName: qualification.packageName,
      },
    },
  }
}

describe('dependency capsules', () => {
  it('flattens a package hook graph, preserves React provenance, and maps contributors', async () => {
    const fixture = await capsuleFixture()
    const capsule = await buildDependencyCapsule(fixture.input)

    expect(capsule.packageName).toBe('capsule-button')
    expect(capsule.packageVersion).toBe('1.2.3')
    expect(capsule.code).toContain('from "react"')
    expect(capsule.code).toContain('from "react/jsx-runtime"')
    expect(capsule.code).toContain('from "plain-helper"')
    expect(capsule.code).toContain('"production"')
    expect(capsule.contributors.some((path) => path.endsWith('/dist/index.mjs'))).toBe(true)
    expect(capsule.contributors.some((path) => path.endsWith('/dist/use-label.mjs'))).toBe(true)
    expect(capsule.contributors).toContain(fixture.input.qualification.manifestPath)
    expect(capsule.contributors.some((path) => path.endsWith('/capsule-hooks/package.json'))).toBe(
      true,
    )
    expect(capsule.sourceMap.sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining('button.mjs'),
        expect.stringContaining('use-label.mjs'),
      ]),
    )

    const compiled = await compileWithCompiler(capsule.code, fixture.entry)
    expect(compiled.code).toContain('__vidactCreateState')
    expect(compiled.code).not.toContain('useState')
    expect(compiled.code).not.toContain('react/jsx-runtime')

    const watched: string[] = []
    const transform = Reflect.get(vidact(), 'transform') as (
      this: {
        readonly environment: { readonly name: string }
        addWatchFile(filename: string): void
      },
      source: string,
      id: string,
    ) => Promise<{ readonly code: string; readonly map?: { readonly sources?: string[] } } | null>
    const transformed = await transform.call(
      {
        environment: { name: 'client' },
        addWatchFile(filename) {
          watched.push(filename)
        },
      },
      fixture.input.source,
      fixture.entry,
    )
    expect(transformed?.code).toContain('__vidactCreateState')
    expect(transformed?.map?.sources).toEqual(
      expect.arrayContaining([
        expect.stringContaining('button.mjs'),
        expect.stringContaining('use-label.mjs'),
      ]),
    )
    expect(watched.some((path) => path.endsWith('/dist/use-label.mjs'))).toBe(true)
  })

  it('keys environments independently and invalidates only contributing files', async () => {
    const fixture = await capsuleFixture()
    const builder = createDependencyCapsuleBuilder()
    const first = await builder.build(fixture.input)
    const server = await builder.build({
      ...fixture.input,
      environment: 'ssr',
      target: 'server',
    })
    expect(server.fingerprint).not.toBe(first.fingerprint)

    await writeFile(fixture.hook, (await readFile(fixture.hook, 'utf8')).replace('Save', 'Updated'))
    expect((await builder.build(fixture.input)).fingerprint).toBe(first.fingerprint)
    await builder.invalidate(join(dirname(fixture.hook), 'unrelated.mjs'))
    expect((await builder.build(fixture.input)).fingerprint).toBe(first.fingerprint)
    await builder.invalidate(fixture.hook)
    expect((await builder.build(fixture.input)).fingerprint).not.toBe(first.fingerprint)
  })

  it('compiles a reachable published entry in a production Vite build', async () => {
    const fixture = await capsuleFixture()
    const app = join(fixture.root, 'src', 'main.tsx')
    await mkdir(dirname(app), { recursive: true })
    await writeFile(
      app,
      `
        import { Button } from 'capsule-button'
        export function App() { return <Button /> }
      `,
    )
    const manifestPath = fixture.input.qualification.manifestPath
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, JSON.stringify({ ...manifest, exports: './dist/index.mjs' }))

    const result = await build({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vidact()],
      build: {
        write: false,
        lib: { entry: app, formats: ['es'] },
        rolldownOptions: {
          external: (specifier) => specifier.startsWith('@vidact/runtime'),
        },
      },
    })
    const outputs = Array.isArray(result) ? result : [result]
    const code = outputs
      .flatMap((output) => ('output' in output ? output.output : []))
      .filter((item) => item.type === 'chunk')
      .map((item) => item.code)
      .join('\n')
    expect(code).toContain('createCompiledState')
    expect(code).not.toMatch(/from\s*["']react(?:\/|["'])/)
    expect(code).not.toContain('useState')
  })

  it('keeps the qualified module analyzable in the Vite development pipeline', async () => {
    const fixture = await capsuleFixture()
    const app = join(fixture.root, 'src', 'main.tsx')
    await mkdir(dirname(app), { recursive: true })
    await writeFile(app, `export { Button } from 'capsule-button'`)
    const manifestPath = fixture.input.qualification.manifestPath
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, JSON.stringify({ ...manifest, exports: './dist/index.mjs' }))

    const server = await createServer({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      plugins: [vidact()],
      resolve: {
        alias: [
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
      const result = await server.transformRequest(fixture.input.qualification.realModulePath)
      expect(result?.code).toContain('__vidactCreateState')
      expect(result?.code).not.toContain('react/jsx-runtime')
      expect(result?.code).not.toContain('useState')
    } finally {
      await server.close()
    }
  })

  it('reports unsupported transitive constructs at the original package source', async () => {
    const fixture = await capsuleFixture()
    await writeFile(
      fixture.hook,
      `import React, { useState } from 'react'
export class UnsupportedPublishedClass extends React.Component {
  render() { return React.createElement('span', null, 'unsupported') }
}
export function useLabel() {
  const [label, setLabel] = useState(React.createElement(UnsupportedPublishedClass, null))
  return { label, setLabel }
}`,
    )
    const transform = Reflect.get(vidact(), 'transform') as (
      this: {
        readonly environment: { readonly name: string }
        addWatchFile(filename: string): void
      },
      source: string,
      id: string,
    ) => Promise<unknown>

    await expect(
      transform.call(
        {
          environment: { name: 'client' },
          addWatchFile() {},
        },
        fixture.input.source,
        fixture.entry,
      ),
    ).rejects.toThrow(/original .*use-label\.mjs:2:\d+.*React class components are unsupported/)
  })
})
