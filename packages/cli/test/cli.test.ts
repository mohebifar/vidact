import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('the vidact binary', () => {
  it('generates a project it can be pointed at', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vidact-cli-bin-'))
    temporaryDirectories.push(cwd)

    const { stdout } = await run(
      process.execPath,
      [entry, 'my-app', '--template', 'start', '--no-install', '--no-git'],
      { cwd },
    )

    expect(stdout).toContain('Created my-app')
    const manifest = JSON.parse(await readFile(path.join(cwd, 'my-app', 'package.json'), 'utf8'))
    expect(manifest.name).toBe('my-app')
    expect(manifest.dependencies['@vidact/start']).toMatch(/^\^\d+\.\d+\.\d+/)
  })

  it('reports usage errors with a non-zero exit code', async () => {
    await expect(run(process.execPath, [entry, '--template', 'nope'])).rejects.toMatchObject({
      code: 1,
    })
  })
})
