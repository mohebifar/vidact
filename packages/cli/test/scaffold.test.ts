import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { CliError } from '../src/errors.ts'
import { renderTemplateFile, scaffold, toOutputName } from '../src/scaffold.ts'
import { templates } from '../src/templates.ts'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'vidact-cli-'))
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

describe('template rendering', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(
      renderTemplateFile('{{projectName}}@{{vidactVersion}} {{other}}', {
        projectName: 'my-app',
        vidactVersion: '1.2.3',
      }),
    ).toBe('my-app@1.2.3 {{other}}')
  })

  it('restores dotfile names', () => {
    expect(toOutputName('_gitignore')).toBe('.gitignore')
    expect(toOutputName('package.json')).toBe('package.json')
    expect(toOutputName('__root.tsx')).toBe('__root.tsx')
  })
})

const signatureFiles: Record<string, readonly string[]> = {
  spa: ['index.html', path.join('src', 'App.tsx')],
  start: [path.join('src', 'start.ts'), path.join('src', 'routes', '__root.tsx')],
  nitro: ['nitro.config.ts', path.join('server', 'routes', '[...].ts')],
}

describe.each(templates)('the $name template', ({ name }) => {
  it('generates an installable project', async () => {
    const root = await temporaryDirectory()
    const directory = path.join(root, 'my-app')

    const result = await scaffold({
      directory,
      projectName: 'my-app',
      template: name,
      vidactVersion: '9.9.9',
    })

    expect(result.directory).toBe(directory)
    expect(result.files).toContain('package.json')
    expect(result.files).toContain('.gitignore')
    expect(result.files).toContain('tsconfig.json')

    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    expect(manifest.name).toBe('my-app')
    expect(manifest.scripts.dev).toBe('vite')
    const vidactVersions = Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })
      .filter(([dependency]) => dependency.startsWith('@vidact/'))
      .map(([, version]) => version)
    expect(vidactVersions.length).toBeGreaterThan(0)
    expect(new Set(vidactVersions)).toEqual(new Set(['^9.9.9']))

    for (const signature of signatureFiles[name] ?? []) {
      expect(result.files).toContain(signature)
    }

    const written = await readdir(directory, { recursive: true })
    expect(written.filter((entry) => path.basename(entry).startsWith('_'))).toEqual(
      name === 'spa' ? [] : [path.join('src', 'routes', '__root.tsx')],
    )
  })
})

describe('scaffold guards', () => {
  it('rejects an unknown template', async () => {
    const directory = await temporaryDirectory()
    await expect(
      scaffold({ directory, projectName: 'my-app', template: 'nope', vidactVersion: '1.0.0' }),
    ).rejects.toThrow(new CliError('unknown template "nope"'))
  })

  it('rejects an invalid project name', async () => {
    const directory = await temporaryDirectory()
    await expect(
      scaffold({ directory, projectName: 'My App', template: 'spa', vidactVersion: '1.0.0' }),
    ).rejects.toThrow(new CliError('"My App" is not a valid npm package name'))
  })

  it('refuses to overwrite a non-empty directory', async () => {
    const directory = await temporaryDirectory()
    await writeFile(path.join(directory, 'keep.txt'), 'keep')
    await expect(
      scaffold({ directory, projectName: 'my-app', template: 'spa', vidactVersion: '1.0.0' }),
    ).rejects.toThrow(`${directory} is not empty`)
  })

  it('accepts a directory that only holds a git repository', async () => {
    const directory = await temporaryDirectory()
    await mkdir(path.join(directory, '.git'))
    const result = await scaffold({
      directory,
      projectName: 'existing',
      template: 'spa',
      vidactVersion: '1.0.0',
    })
    expect(result.files).toContain('package.json')
  })
})
