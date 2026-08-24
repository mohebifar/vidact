import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { publicPackages } from './public-packages.mjs'

const defaultRepository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function verifyReleaseVersion({ repository = defaultRepository, actualTag } = {}) {
  const manifests = await Promise.all(
    publicPackages.map(async ({ manifestPath }) => ({
      manifestPath,
      manifest: JSON.parse(await readFile(path.join(repository, manifestPath), 'utf8')),
    })),
  )
  const version = manifests[0].manifest.version
  const mismatches = manifests.filter(({ manifest }) => manifest.version !== version)
  if (mismatches.length > 0) {
    throw new Error(
      `public package versions must match ${version}: ${mismatches
        .map(({ manifestPath, manifest }) => `${manifestPath}=${manifest.version}`)
        .join(', ')}`,
    )
  }

  const pendingChangesets = (await readdir(path.join(repository, '.changeset'))).filter(
    (filename) => filename.endsWith('.md') && filename !== 'README.md',
  )
  if (pendingChangesets.length > 0) {
    throw new Error(`release cannot contain pending changesets: ${pendingChangesets.join(', ')}`)
  }

  const expectedTag = `v${version}`
  if (actualTag !== undefined && actualTag !== expectedTag) {
    throw new Error(`release tag ${actualTag} does not match package version ${expectedTag}`)
  }

  return version
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const version = await verifyReleaseVersion({ actualTag: process.argv[2] })
  process.stdout.write(`${version}\n`)
}
