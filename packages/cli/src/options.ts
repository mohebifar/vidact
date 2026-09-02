import { parseArgs } from 'node:util'

import { CliError } from './errors.ts'
import { isPackageManager, type PackageManager } from './package-manager.ts'
import { findTemplate, templateNames } from './templates.ts'

export interface ParsedOptions {
  readonly directory: string | undefined
  readonly template: string | undefined
  readonly packageManager: PackageManager | undefined
  readonly install: boolean | undefined
  readonly git: boolean | undefined
  readonly yes: boolean
  readonly help: boolean
  readonly version: boolean
}

function resolveNegatable(
  positive: boolean | undefined,
  negative: boolean | undefined,
  flag: string,
): boolean | undefined {
  if (positive === true && negative === true) {
    throw new CliError(`--${flag} and --no-${flag} cannot be combined`)
  }
  if (positive === true) return true
  if (negative === true) return false
  return undefined
}

export function parseOptions(argv: readonly string[]): ParsedOptions {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        git: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        install: { type: 'boolean' },
        'no-git': { type: 'boolean' },
        'no-install': { type: 'boolean' },
        'package-manager': { type: 'string', short: 'p' },
        template: { type: 'string', short: 't' },
        version: { type: 'boolean', short: 'v' },
        yes: { type: 'boolean', short: 'y' },
      },
    })
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error))
  }

  const { positionals, values } = parsed
  if (positionals.length > 1) {
    throw new CliError(`expected at most one directory, received ${positionals.length}`)
  }

  const template = values.template
  if (template !== undefined && findTemplate(template) === undefined) {
    throw new CliError(
      `unknown template "${template}"; expected one of ${templateNames().join(', ')}`,
    )
  }

  const packageManager = values['package-manager']
  if (packageManager !== undefined && !isPackageManager(packageManager)) {
    throw new CliError(`unknown package manager "${packageManager}"`)
  }

  return {
    directory: positionals[0],
    git: resolveNegatable(values.git, values['no-git'], 'git'),
    help: values.help === true,
    install: resolveNegatable(values.install, values['no-install'], 'install'),
    packageManager,
    template,
    version: values.version === true,
    yes: values.yes === true,
  }
}
