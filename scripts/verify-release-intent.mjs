import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const releaseIntentPattern = /^\.changeset\/[^/]+\.md$/

export function isReleaseIntentPath(filePath) {
  return filePath !== '.changeset/README.md' && releaseIntentPattern.test(filePath)
}

export function parseChangedPaths(output) {
  return Buffer.from(output).toString('utf8').split('\0').filter(isReleaseIntentPath)
}

export function verifyReleaseIntent({
  baseRef = 'origin/main',
  cwd = process.cwd(),
  runGit = spawnSync,
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(baseRef) || baseRef.includes('..')) {
    throw new Error(`invalid changeset base ref: ${baseRef}`)
  }

  const result = runGit(
    'git',
    ['diff', '--name-only', '--diff-filter=AM', '-z', `${baseRef}...HEAD`, '--', '.changeset'],
    { cwd },
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`git diff failed with exit code ${result.status}`)
  }

  const changesets = parseChangedPaths(result.stdout)
  if (changesets.length === 0) {
    throw new Error(
      'release intent is required: add a .changeset/*.md file (an empty changeset is valid when no package release is needed)',
    )
  }

  return changesets
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const changesets = verifyReleaseIntent({ baseRef: process.env.CHANGESET_BASE_REF })
    console.log(`release intent: ${changesets.join(', ')}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
