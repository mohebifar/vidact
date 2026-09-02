import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CliCancelledError } from '../src/errors.ts'
import type { Installer } from '../src/package-manager.ts'
import type { Prompter } from '../src/prompt.ts'
import { createPlainReporter } from '../src/reporter.ts'
import { run, type Execute } from '../src/run.ts'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'vidact-cli-run-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

function collect(): { output: () => string; write: (message: string) => void } {
  const chunks: string[] = []
  return { output: () => chunks.join(''), write: (message) => void chunks.push(message) }
}

const succeed: Execute = () => Promise.resolve({ code: 0 })
const installed: Installer = () => Promise.resolve()

async function readManifest(...segments: string[]): Promise<Record<string, never>> {
  return JSON.parse(await readFile(path.join(...segments, 'package.json'), 'utf8'))
}

describe('run', () => {
  it('prints help and exits successfully', async () => {
    const { output, write } = collect()
    expect(await run({ argv: ['--help'], cwd: '/', version: '1.0.0', write })).toBe(0)
    expect(output()).toContain('Usage')
  })

  it('prints the version', async () => {
    const { output, write } = collect()
    expect(await run({ argv: ['--version'], cwd: '/', version: '1.0.0', write })).toBe(0)
    expect(output()).toBe('1.0.0\n')
  })

  it('reports invalid usage with the help text', async () => {
    const { output, write } = collect()
    expect(await run({ argv: ['--template', 'nope'], cwd: '/', version: '1.0.0', write })).toBe(1)
    expect(output()).toContain('unknown template "nope"')
  })

  it('generates a project without prompting when it is not interactive', async () => {
    const cwd = await temporaryDirectory()
    const { output, write } = collect()
    const execute = vi.fn<Execute>(succeed)
    const install = vi.fn<Installer>(installed)

    expect(
      await run({
        argv: ['my-app', '--template', 'spa'],
        cwd,
        execute,
        install,
        interactive: false,
        version: '9.9.9',
        write,
      }),
    ).toBe(0)

    expect(execute).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(await readManifest(cwd, 'my-app')).toMatchObject({ name: 'my-app' })
    expect(output()).toContain('cd my-app')
    expect(output()).toContain('install')
  })

  it('normalizes a directory name that is not a valid package name', async () => {
    const cwd = await temporaryDirectory()
    const { write } = collect()

    expect(await run({ argv: ['My App'], cwd, interactive: false, version: '9.9.9', write })).toBe(
      0,
    )

    expect(await readManifest(cwd, 'My App')).toMatchObject({ name: 'my-app' })
  })

  it('initializes git and installs with the requested package manager', async () => {
    const cwd = await temporaryDirectory()
    const { output, write } = collect()
    const execute = vi.fn<Execute>(succeed)
    const install = vi.fn<Installer>(installed)

    expect(
      await run({
        argv: ['my-app', '--git', '--install', '--package-manager', 'pnpm'],
        cwd,
        execute,
        install,
        interactive: false,
        version: '9.9.9',
        write,
      }),
    ).toBe(0)

    const target = path.join(cwd, 'my-app')
    expect(execute.mock.calls).toEqual([['git', ['init'], target]])
    expect(install.mock.calls).toEqual([[{ cwd: target, packageManager: 'pnpm' }]])
    expect(output()).toContain('pnpm run dev')
    expect(output()).not.toContain('pnpm install')
  })

  it('warns about a failing step without failing the run', async () => {
    const cwd = await temporaryDirectory()
    const { output, write } = collect()

    expect(
      await run({
        argv: ['my-app', '--install'],
        cwd,
        install: () => Promise.reject(new Error('registry unreachable')),
        interactive: false,
        version: '9.9.9',
        write,
      }),
    ).toBe(0)

    expect(output()).toContain('registry unreachable')
    expect(await readManifest(cwd, 'my-app')).toMatchObject({ name: 'my-app' })
  })

  it('refuses to write into a non-empty directory', async () => {
    const cwd = await temporaryDirectory()
    const { output, write } = collect()
    await run({ argv: ['my-app'], cwd, interactive: false, version: '9.9.9', write })

    const { output: second, write: writeSecond } = collect()
    expect(
      await run({
        argv: ['my-app'],
        cwd,
        interactive: false,
        version: '9.9.9',
        write: writeSecond,
      }),
    ).toBe(1)
    expect(second()).toContain('is not empty')
    expect(output()).toContain('Created my-app')
  })

  it('asks for the answers it was not given', async () => {
    const cwd = await temporaryDirectory()
    const { write } = collect()
    const prompt: Prompter = {
      text: vi.fn<Prompter['text']>(() => Promise.resolve('prompted-app')),
      choice: vi.fn<Prompter['choice']>(() => Promise.resolve('start')),
      confirm: vi.fn<Prompter['confirm']>(() => Promise.resolve(false)),
    }

    expect(
      await run({
        argv: [],
        createPrompt: () => prompt,
        cwd,
        interactive: true,
        reporter: createPlainReporter(write),
        version: '9.9.9',
        write,
      }),
    ).toBe(0)

    expect(prompt.text).toHaveBeenCalledTimes(1)
    expect(prompt.choice).toHaveBeenCalledTimes(1)
    expect(prompt.confirm).toHaveBeenCalledTimes(2)
    expect(await readManifest(cwd, 'prompted-app')).toMatchObject({
      dependencies: { '@vidact/start': '^9.9.9' },
    })
  })

  it('exits with 130 when a prompt is cancelled', async () => {
    const cwd = await temporaryDirectory()
    const { output, write } = collect()
    const prompt: Prompter = {
      text: vi.fn<Prompter['text']>(() => Promise.reject(new CliCancelledError())),
      choice: vi.fn<Prompter['choice']>(() => Promise.resolve('spa')),
      confirm: vi.fn<Prompter['confirm']>(() => Promise.resolve(false)),
    }

    expect(
      await run({
        argv: [],
        createPrompt: () => prompt,
        cwd,
        interactive: true,
        reporter: createPlainReporter(write),
        version: '9.9.9',
        write,
      }),
    ).toBe(130)
    expect(output()).toContain('Cancelled.')
  })

  it('skips prompting when --yes is passed', async () => {
    const cwd = await temporaryDirectory()
    const { write } = collect()
    const createPrompt = vi.fn<() => Prompter>()

    expect(
      await run({
        argv: ['--yes'],
        createPrompt,
        cwd,
        interactive: true,
        reporter: createPlainReporter(write),
        version: '9.9.9',
        write,
      }),
    ).toBe(0)

    expect(createPrompt).not.toHaveBeenCalled()
    expect(await readManifest(cwd, 'vidact-app')).toMatchObject({ name: 'vidact-app' })
  })
})
