import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  isReleaseIntentPath,
  parseChangedPaths,
  verifyReleaseIntent,
} from './verify-release-intent.mjs'

test('recognizes only direct changeset markdown files other than README', () => {
  assert.equal(isReleaseIntentPath('.changeset/quick-dogs.md'), true)
  assert.equal(isReleaseIntentPath('.changeset/README.md'), false)
  assert.equal(isReleaseIntentPath('.changeset/nested/quick-dogs.md'), false)
  assert.equal(isReleaseIntentPath('.changeset/quick-dogs.txt'), false)
})

test('parses null-delimited git output', () => {
  assert.deepEqual(
    parseChangedPaths(
      Buffer.from(
        '.changeset/README.md\0.changeset/quick-dogs.md\0packages/runtime/src/index.ts\0',
      ),
    ),
    ['.changeset/quick-dogs.md'],
  )
})

test('accepts an added or modified changeset and uses the pull request base', () => {
  const calls = []
  const changesets = verifyReleaseIntent({
    baseRef: 'abc123',
    runGit(command, args, options) {
      calls.push({ command, args, options })
      return { status: 0, stdout: Buffer.from('.changeset/release.md\0') }
    },
  })

  assert.deepEqual(changesets, ['.changeset/release.md'])
  assert.deepEqual(calls[0].args, [
    'diff',
    '--name-only',
    '--diff-filter=AM',
    '-z',
    'abc123...HEAD',
    '--',
    '.changeset',
  ])
})

test('rejects a pull request without an added or modified changeset', () => {
  assert.throws(
    () =>
      verifyReleaseIntent({
        baseRef: 'abc123',
        runGit() {
          return { status: 0, stdout: Buffer.from('') }
        },
      }),
    /release intent is required/,
  )
})

test('CI exempts only the exact same-repository Changesets version branch', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const exactVersionBranchGuard =
    "github.event_name == 'pull_request' && (github.head_ref != 'changeset-release/main' || github.event.pull_request.head.repo.full_name != github.repository)"

  assert.equal(workflow.split(exactVersionBranchGuard).length - 1, 2)
  assert.doesNotMatch(workflow, /startsWith\(github\.head_ref/)
})
