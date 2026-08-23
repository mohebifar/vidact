import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'vidact-packages-'))
const tarballDirectory = path.join(temporaryRoot, 'tarballs')
const consumerDirectory = path.join(temporaryRoot, 'consumer')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const node = process.execPath

const packages = [
  ['@vidact/runtime', 'packages/runtime/package.json'],
  ['@vidact/test-support', 'packages/test-support/package.json'],
  ['@vidact/vite', 'packages/vite-plugin/package.json'],
  ['@vidact/react-types', 'packages/react-types/package.json'],
]

function run(command, arguments_, cwd = repository) {
  execFileSync(command, arguments_, { cwd, stdio: 'inherit' })
}

try {
  await mkdir(tarballDirectory)
  await mkdir(consumerDirectory)
  const tarballs = new Map()
  const manifests = await Promise.all(
    packages.map(async ([name, manifestPath]) => [
      name,
      JSON.parse(await readFile(path.join(repository, manifestPath), 'utf8')),
    ]),
  )
  for (const [name, manifest] of manifests) {
    const filename = `${name.slice(1).replace('/', '-')}-${manifest.version}.tgz`
    run(pnpm, ['--filter', name, 'pack', '--pack-destination', tarballDirectory])
    tarballs.set(name, filename)
  }

  const dependency = (name) => `file:../tarballs/${tarballs.get(name)}`
  await writeFile(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vidact-package-smoke',
        private: true,
        type: 'module',
        dependencies: {
          '@vidact/react-types': dependency('@vidact/react-types'),
          '@vidact/runtime': dependency('@vidact/runtime'),
          '@vidact/test-support': dependency('@vidact/test-support'),
          '@vidact/vite': dependency('@vidact/vite'),
          '@types/node': '24.13.3',
          '@types/react': '19.2.18',
          typescript: '7.0.2',
          vite: '8.2.2',
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: 'react-jsx',
          jsxImportSource: '@vidact/react-types',
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          strict: true,
          target: 'ESNext',
          types: ['node'],
        },
        include: ['smoke.tsx'],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    path.join(consumerDirectory, 'smoke.tsx'),
    `import { source, type CompiledRenderValue } from '@vidact/runtime'
import { Suspense, createResource, lazy } from '@vidact/runtime/async'
import { flushSync, startTransition } from '@vidact/runtime/concurrent'
import { createCompiledActionState, useActionState } from '@vidact/runtime/actions'
import { Suspense as AsyncActionsSuspense } from '@vidact/runtime/async/actions'
import { renderToStaticMarkup as renderActionsToStaticMarkup } from '@vidact/runtime/actions/server'
import { renderToStaticMarkup } from '@vidact/runtime/server'
import { act } from '@vidact/test-support'
import { vidact } from '@vidact/vite'

const view: CompiledRenderValue = <button onClick={(event) => event.currentTarget.focus()}>ok</button>
const actionView: CompiledRenderValue = <form action={async (_data) => {}} />
void view
void actionView
void source(0)
void Suspense
void createResource
void lazy
void flushSync
void startTransition
void createCompiledActionState
void useActionState
void AsyncActionsSuspense
void act
void vidact()
if (renderToStaticMarkup(() => 'ready') !== 'ready') throw new Error('server entry failed')
if (renderActionsToStaticMarkup(() => 'ready') !== 'ready') throw new Error('Actions server entry failed')
`,
  )
  await writeFile(
    path.join(consumerDirectory, 'smoke.mjs'),
    `import { VIDACT_RUNTIME_PROTOCOL } from '@vidact/runtime/protocol'
import { Suspense, createResource, lazy } from '@vidact/runtime/async'
import { flushSync, startTransition } from '@vidact/runtime/concurrent'
import { createCompiledActionState, useActionState } from '@vidact/runtime/actions'
import { Suspense as AsyncActionsSuspense } from '@vidact/runtime/async/actions'
import { renderToStaticMarkup as renderActionsToStaticMarkup } from '@vidact/runtime/actions/server'
import { renderToStaticMarkup } from '@vidact/runtime/server'
import { act } from '@vidact/test-support'
import { vidact } from '@vidact/vite'

if (VIDACT_RUNTIME_PROTOCOL !== 'vidact-runtime-v1') throw new Error('runtime entry failed')
if (renderToStaticMarkup(() => 'ready') !== 'ready') throw new Error('server entry failed')
if ([Suspense, createResource, lazy].some((value) => typeof value !== 'function')) throw new Error('async entry failed')
if ([flushSync, startTransition].some((value) => typeof value !== 'function')) throw new Error('concurrent entry failed')
if ([createCompiledActionState, useActionState, AsyncActionsSuspense].some((value) => typeof value !== 'function')) throw new Error('Actions entry failed')
if (renderActionsToStaticMarkup(() => 'ready') !== 'ready') throw new Error('Actions server entry failed')
if (typeof act !== 'function' || typeof vidact !== 'function') throw new Error('package entry failed')
`,
  )

  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDirectory)
  run(node, ['smoke.mjs'], consumerDirectory)
  const tsc = path.join(
    consumerDirectory,
    'node_modules',
    '.bin',
    `tsc${process.platform === 'win32' ? '.cmd' : ''}`,
  )
  run(tsc, ['-p', 'tsconfig.json'], consumerDirectory)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
