import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { publicPackages } from './public-packages.mjs'

/* oxlint-disable no-await-in-loop -- Publishing is deliberately sequential so dependencies land before their consumers. */

const [tarballDirectoryArgument] = process.argv.slice(2)
if (tarballDirectoryArgument === undefined) {
  throw new Error('usage: publish-release-packages.mjs <tarball-directory>')
}

const tarballDirectory = path.resolve(tarballDirectoryArgument)
const tarballs = await Promise.all(
  (await readdir(tarballDirectory))
    .filter((filename) => filename.endsWith('.tgz'))
    .map(async (filename) => {
      const tarballPath = path.join(tarballDirectory, filename)
      const manifest = JSON.parse(
        execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
          encoding: 'utf8',
        }),
      )
      const integrity = `sha512-${createHash('sha512')
        .update(await readFile(tarballPath))
        .digest('base64')}`
      return { integrity, manifest, tarballPath }
    }),
)

const native = tarballs
  .filter(({ manifest }) => manifest.name.startsWith('@vidact/compiler-'))
  .toSorted((left, right) => left.manifest.name.localeCompare(right.manifest.name))
const rootsByName = new Map(tarballs.map((entry) => [entry.manifest.name, entry]))
const roots = publicPackages.map(({ name }) => {
  const entry = rootsByName.get(name)
  if (entry === undefined) throw new Error(`missing release tarball for ${name}`)
  return entry
})
const compilerVersion = rootsByName.get('@vidact/compiler').manifest.version
const tag = compilerVersion.includes('-') ? 'next' : 'latest'
if (native.length !== 7 || tarballs.length !== native.length + roots.length) {
  throw new Error(
    `expected 7 native and ${publicPackages.length} root tarballs, found ${native.length} and ${roots.length}`,
  )
}

for (const entry of [...native, ...roots]) {
  const { name, version } = entry.manifest
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { headers: { accept: 'application/json' } },
  )
  if (response.status === 404) {
    execFileSync('npm', ['publish', entry.tarballPath, '--tag', tag, '--access', 'public'], {
      stdio: 'inherit',
    })
    continue
  }
  if (!response.ok) {
    throw new Error(`could not check ${name}@${version}: npm returned ${response.status}`)
  }
  const metadata = await response.json()
  const publishedIntegrity = metadata.dist?.integrity
  if (publishedIntegrity !== entry.integrity) {
    throw new Error(
      `${name}@${version} already exists with integrity ${String(publishedIntegrity)}, expected ${entry.integrity}`,
    )
  }
  process.stdout.write(`already published with matching integrity: ${name}@${version}\n`)
}
