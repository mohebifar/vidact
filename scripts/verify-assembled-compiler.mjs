import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const tarballDirectory = path.resolve(process.argv[2] ?? '')
const version = process.argv[3]
if (!version) throw new Error('usage: verify-assembled-compiler.mjs <tarball-directory> <version>')

const nativeSuffixes = [
  'darwin-arm64',
  'darwin-x64',
  'win32-x64-msvc',
  'linux-arm64-gnu',
  'linux-x64-gnu',
  'linux-arm64-musl',
  'linux-x64-musl',
]
const compilerTarball = path.join(tarballDirectory, `vidact-compiler-${version}.tgz`)
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'vidact-assembled-compiler-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

try {
  const optionalDependencies = Object.fromEntries(
    nativeSuffixes.map((suffix) => [
      `@vidact/compiler-${suffix}`,
      `file:${path.join(tarballDirectory, `vidact-compiler-${suffix}-${version}.tgz`)}`,
    ]),
  )
  await writeFile(
    path.join(temporaryRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'vidact-assembled-compiler-smoke',
        private: true,
        type: 'module',
        dependencies: { '@vidact/compiler': `file:${compilerTarball}` },
        optionalDependencies,
      },
      null,
      2,
    )}\n`,
  )
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: temporaryRoot,
    env: { ...process.env, NPM_CONFIG_CACHE: path.join(temporaryRoot, '.npm-cache') },
    stdio: 'inherit',
  })
  const installedManifest = JSON.parse(
    await readFile(path.join(temporaryRoot, 'node_modules/@vidact/compiler/package.json'), 'utf8'),
  )
  const installedOptionalDependencies = installedManifest.optionalDependencies ?? {}
  if (
    Object.keys(installedOptionalDependencies).length !== nativeSuffixes.length ||
    !nativeSuffixes.every(
      (suffix) => installedOptionalDependencies[`@vidact/compiler-${suffix}`] === version,
    )
  ) {
    throw new Error('assembled compiler has incorrect native optional dependencies')
  }
  const installedScope = path.join(temporaryRoot, 'node_modules/@vidact')
  const installedNativePackages = (await readdir(installedScope)).filter((name) =>
    name.startsWith('compiler-'),
  )
  if (installedNativePackages.length !== 1) {
    throw new Error(`expected npm to select one native package, found ${installedNativePackages}`)
  }
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { compileSync } from '@vidact/compiler'; const result = compileSync('export function App() { return <main>ready</main> }', { filename: 'App.tsx' }); if (result.protocol !== 'vidact-compile-v2') throw new Error('compile failed')`,
    ],
    { cwd: temporaryRoot, stdio: 'inherit' },
  )
  const cli = path.join(
    temporaryRoot,
    'node_modules/.bin',
    `vidactc${process.platform === 'win32' ? '.cmd' : ''}`,
  )
  const analysis = execFileSync(cli, ['analyze', '--filename', 'App.tsx'], {
    cwd: temporaryRoot,
    encoding: 'utf8',
    input: 'export function App() { return <main>ready</main> }',
  })
  if (JSON.parse(analysis).protocol !== 'vidact-analysis-v1') {
    throw new Error('assembled compiler CLI failed')
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
