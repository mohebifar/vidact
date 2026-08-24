import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { publicPackages } from './public-packages.mjs'
import { verifyReleaseVersion } from './verify-release-version.mjs'

async function createRepository(t, version = '1.2.3') {
  const repository = await mkdtemp(path.join(tmpdir(), 'vidact-release-version-'))
  t.after(() => rm(repository, { recursive: true, force: true }))

  await mkdir(path.join(repository, '.changeset'))
  await writeFile(path.join(repository, '.changeset', 'README.md'), 'Changeset instructions\n')
  await Promise.all(
    publicPackages.map(async ({ manifestPath, name }) => {
      const absoluteManifestPath = path.join(repository, manifestPath)
      await mkdir(path.dirname(absoluteManifestPath), { recursive: true })
      await writeFile(absoluteManifestPath, `${JSON.stringify({ name, version }, null, 2)}\n`)
    }),
  )

  return repository
}

test('accepts a coordinated public package version', async (t) => {
  const repository = await createRepository(t)

  assert.equal(await verifyReleaseVersion({ repository, actualTag: 'v1.2.3' }), '1.2.3')
})

test('rejects a pending release changeset', async (t) => {
  const repository = await createRepository(t)
  await writeFile(path.join(repository, '.changeset', 'pending-release.md'), '---\n')

  await assert.rejects(
    verifyReleaseVersion({ repository, actualTag: 'v1.2.3' }),
    /release cannot contain pending changesets: pending-release\.md/,
  )
})

test('rejects mismatched public package versions', async (t) => {
  const repository = await createRepository(t)
  const mismatchedPackage = publicPackages.at(-1)
  await writeFile(
    path.join(repository, mismatchedPackage.manifestPath),
    `${JSON.stringify({ name: mismatchedPackage.name, version: '2.0.0' }, null, 2)}\n`,
  )

  await assert.rejects(
    verifyReleaseVersion({ repository, actualTag: 'v1.2.3' }),
    new RegExp(
      `public package versions must match 1\\.2\\.3: ${mismatchedPackage.manifestPath}=2\\.0\\.0`,
    ),
  )
})

test('rejects a tag that does not match the package version', async (t) => {
  const repository = await createRepository(t)

  await assert.rejects(
    verifyReleaseVersion({ repository, actualTag: 'v1.2.4' }),
    /release tag v1\.2\.4 does not match package version v1\.2\.3/,
  )
})
