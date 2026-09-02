import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { publicPackages } from './public-packages.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'vidact-packages-'))
const tarballDirectory = path.join(temporaryRoot, 'tarballs')
const consumerDirectory = path.join(temporaryRoot, 'consumer')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const node = process.execPath
let nativePackageRoot

function run(command, arguments_, cwd = repository) {
  execFileSync(command, arguments_, { cwd, stdio: 'inherit' })
}

try {
  await mkdir(tarballDirectory)
  await mkdir(consumerDirectory)
  const tarballs = new Map()
  const compilerDirectory = path.join(repository, 'packages/compiler')
  nativePackageRoot = await mkdtemp(path.join(compilerDirectory, '.verify-npm-'))
  run(pnpm, ['exec', 'napi', 'create-npm-dirs', '--npm-dir', nativePackageRoot], compilerDirectory)
  const nativeFilenames = (await readdir(path.join(compilerDirectory, 'dist'))).filter(
    (filename) => filename.startsWith('vidact-compiler.') && filename.endsWith('.node'),
  )
  if (nativeFilenames.length !== 1) {
    throw new Error(`expected one host native addon, found ${nativeFilenames.length}`)
  }
  const nativeFilename = nativeFilenames[0]
  const nativeSuffix = nativeFilename.slice('vidact-compiler.'.length, -'.node'.length)
  const nativePackageDirectory = path.join(nativePackageRoot, nativeSuffix)
  await copyFile(
    path.join(compilerDirectory, 'dist', nativeFilename),
    path.join(nativePackageDirectory, nativeFilename),
  )
  const nativePackageName = `@vidact/compiler-${nativeSuffix}`
  const nativeManifest = JSON.parse(
    await readFile(path.join(nativePackageDirectory, 'package.json'), 'utf8'),
  )
  run(pnpm, ['pack', '--pack-destination', tarballDirectory], nativePackageDirectory)
  const nativeTarball = `${nativePackageName.slice(1).replace('/', '-')}-${nativeManifest.version}.tgz`
  const manifests = await Promise.all(
    publicPackages.map(async ({ name, manifestPath }) => [
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
          '@vidact/compiler': dependency('@vidact/compiler'),
          '@vidact/runtime': dependency('@vidact/runtime'),
          '@vidact/start': dependency('@vidact/start'),
          '@vidact/test-support': dependency('@vidact/test-support'),
          '@vidact/vite': dependency('@vidact/vite'),
          '@types/node': '24.13.3',
          '@types/react': '19.2.18',
          typescript: '7.0.2',
          vite: '8.2.2',
        },
        optionalDependencies: {
          [nativePackageName]: `file:../tarballs/${nativeTarball}`,
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
    `import { compile, type VidactCompilation } from '@vidact/compiler'
import { source, type CompiledRenderValue } from '@vidact/runtime'
import { Suspense, createResource, lazy } from '@vidact/runtime/async'
import { flushSync, startTransition } from '@vidact/runtime/concurrent'
import { createCompiledActionState, useActionState } from '@vidact/runtime/actions'
import { enableDomForms } from '@vidact/runtime/dom/forms'
import { enableDomNamespace } from '@vidact/runtime/dom/namespace'
import { enableDomStyles } from '@vidact/runtime/dom/styles'
import { renderToStaticMarkup } from '@vidact/runtime/server'
import { createRouteManifest, defineFileRoute } from '@vidact/start'
import { createStartHandler } from '@vidact/start/server'
import { vidactStart } from '@vidact/start/vite'
import { act } from '@vidact/test-support'
import { vidact } from '@vidact/vite'

const view: CompiledRenderValue = <button onClick={(event) => event.currentTarget.focus()}>ok</button>
const actionView: CompiledRenderValue = <form action={async (_data) => {}} />
const compilation: Promise<VidactCompilation> = compile('export function App() { return <main /> }', { filename: 'App.tsx' })
void view
void actionView
void compilation
void source(0)
void Suspense
void createResource
void lazy
void flushSync
void startTransition
void createCompiledActionState
void useActionState
void enableDomForms()
void enableDomNamespace()
void enableDomStyles()
void act
void vidact()
void createStartHandler({
  manifest: createRouteManifest([
    {
      id: 'index',
      parentId: null,
      path: '/',
      load: async () => ({ Route: defineFileRoute({ component: () => 'ready' }) }),
    },
  ]),
})
void vidactStart({ serverEntry: false })
if (renderToStaticMarkup(() => 'ready') !== 'ready') throw new Error('server entry failed')
`,
  )
  await writeFile(
    path.join(consumerDirectory, 'smoke.mjs'),
    `import { compileSync } from '@vidact/compiler'
import { VIDACT_RUNTIME_PROTOCOL } from '@vidact/runtime/protocol'
import { Suspense, createResource, lazy } from '@vidact/runtime/async'
import { flushSync, startTransition } from '@vidact/runtime/concurrent'
import { createCompiledActionState, useActionState } from '@vidact/runtime/actions'
import { enableDomForms } from '@vidact/runtime/dom/forms'
import { enableDomNamespace } from '@vidact/runtime/dom/namespace'
import { enableDomStyles } from '@vidact/runtime/dom/styles'
import { renderToStaticMarkup } from '@vidact/runtime/server'
import { createRouteManifest, defineFileRoute } from '@vidact/start'
import { createStartHandler } from '@vidact/start/server'
import { vidactStart } from '@vidact/start/vite'
import { act } from '@vidact/test-support'
import { vidact } from '@vidact/vite'

const compilation = compileSync('export function App() { return <main>ready</main> }', { filename: 'App.tsx' })
if (compilation.protocol !== 'vidact-compile-v2' || !compilation.code.includes('__vidactCompiledRoot')) throw new Error('compiler entry failed')
if (VIDACT_RUNTIME_PROTOCOL !== 'vidact-runtime-v2') throw new Error('runtime entry failed')
if (renderToStaticMarkup(() => 'ready') !== 'ready') throw new Error('server entry failed')
if ([Suspense, createResource, lazy].some((value) => typeof value !== 'function')) throw new Error('async entry failed')
if ([flushSync, startTransition].some((value) => typeof value !== 'function')) throw new Error('concurrent entry failed')
if ([createCompiledActionState, useActionState].some((value) => typeof value !== 'function')) throw new Error('Actions entry failed')
enableDomForms()
enableDomNamespace()
enableDomStyles()
if (typeof act !== 'function' || typeof vidact !== 'function') throw new Error('package entry failed')
const startHandler = createStartHandler({
  manifest: createRouteManifest([
    {
      id: 'index',
      parentId: null,
      path: '/',
      load: async () => ({ Route: defineFileRoute({ component: () => 'ready' }) }),
    },
  ]),
})
if ((await startHandler(new Request('https://example.test/'))).status !== 200) throw new Error('Start server entry failed')
if (vidactStart({ serverEntry: false }).length !== 3) throw new Error('Start Vite entry failed')
`,
  )

  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDirectory)
  run(node, ['smoke.mjs'], consumerDirectory)
  const vidactc = path.join(
    consumerDirectory,
    'node_modules',
    '.bin',
    `vidactc${process.platform === 'win32' ? '.cmd' : ''}`,
  )
  const cliOutput = execFileSync(vidactc, ['analyze', '--filename', 'Cli.tsx'], {
    cwd: consumerDirectory,
    encoding: 'utf8',
    input: 'export function Cli() { return <p>ready</p> }',
  })
  if (JSON.parse(cliOutput).protocol !== 'vidact-analysis-v1') {
    throw new Error('compiler CLI entry failed')
  }
  const tsc = path.join(
    consumerDirectory,
    'node_modules',
    '.bin',
    `tsc${process.platform === 'win32' ? '.cmd' : ''}`,
  )
  run(tsc, ['-p', 'tsconfig.json'], consumerDirectory)
} finally {
  if (nativePackageRoot !== undefined) {
    await rm(nativePackageRoot, { recursive: true, force: true })
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}
