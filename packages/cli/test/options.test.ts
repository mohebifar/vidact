import { describe, expect, it } from 'vitest'

import { CliError } from '../src/errors.ts'
import { parseOptions } from '../src/options.ts'

describe('option parsing', () => {
  it('reads the directory, template, and package manager', () => {
    expect(parseOptions(['my-app', '--template', 'start', '-p', 'pnpm'])).toMatchObject({
      directory: 'my-app',
      packageManager: 'pnpm',
      template: 'start',
    })
  })

  it('leaves unset choices undefined', () => {
    expect(parseOptions([])).toEqual({
      directory: undefined,
      git: undefined,
      help: false,
      install: undefined,
      packageManager: undefined,
      template: undefined,
      version: false,
      yes: false,
    })
  })

  it.each([
    [['--install'], true],
    [['--no-install'], false],
  ])('resolves %s to install=%s', (argv, install) => {
    expect(parseOptions(argv).install).toBe(install)
  })

  it.each([
    [['--git'], true],
    [['--no-git'], false],
  ])('resolves %s to git=%s', (argv, git) => {
    expect(parseOptions(argv).git).toBe(git)
  })

  it.each([
    [['--install', '--no-install'], '--install and --no-install cannot be combined'],
    [['--git', '--no-git'], '--git and --no-git cannot be combined'],
    [['--template', 'nope'], 'unknown template "nope"; expected one of spa, start, nitro'],
    [['--package-manager', 'nope'], 'unknown package manager "nope"'],
    [['one', 'two'], 'expected at most one directory, received 2'],
  ])('rejects %s', (argv, message) => {
    expect(() => parseOptions(argv)).toThrow(new CliError(message))
  })

  it('rejects unknown flags', () => {
    expect(() => parseOptions(['--nope'])).toThrow(CliError)
  })
})
