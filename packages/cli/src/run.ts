import { spawn } from 'node:child_process'
import path from 'node:path'

import { CliCancelledError, CliError } from './errors.ts'
import { helpText } from './help.ts'
import { parseOptions } from './options.ts'
import {
  install as installWithPackageManager,
  installCommand,
  resolvePackageManager,
  runCommand,
  type Installer,
  type PackageManager,
} from './package-manager.ts'
import { isValidPackageName, toPackageName } from './package-name.ts'
import { createPrompter, type Prompter } from './prompt.ts'
import { createClackReporter, createPlainReporter, type Reporter } from './reporter.ts'
import { scaffold } from './scaffold.ts'
import { defaultTemplate, templates } from './templates.ts'

export type Execute = (
  command: string,
  argv: readonly string[],
  cwd: string,
) => Promise<{ readonly code: number }>

export interface RunOptions {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly version: string
  readonly interactive?: boolean
  readonly write?: (message: string) => void
  readonly execute?: Execute
  readonly install?: Installer
  readonly createPrompt?: () => Prompter
  readonly reporter?: Reporter
}

const spawnProcess: Execute = (command, argv, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...argv], { cwd, stdio: 'ignore', shell: false })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1 }))
  })

export async function run(options: RunOptions): Promise<number> {
  const write = options.write ?? ((message: string) => void process.stdout.write(message))
  const interactive =
    options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)
  const reporter =
    options.reporter ?? (interactive ? createClackReporter() : createPlainReporter(write))

  let parsed
  try {
    parsed = parseOptions(options.argv)
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    write(`${error.message}\n\n${helpText()}`)
    return 1
  }

  if (parsed.help) {
    write(helpText())
    return 0
  }
  if (parsed.version) {
    write(`${options.version}\n`)
    return 0
  }

  const prompt = interactive && !parsed.yes ? (options.createPrompt ?? createPrompter)() : undefined

  try {
    reporter.intro('Create a Vidact project')

    const directory =
      parsed.directory ??
      (prompt === undefined ? 'vidact-app' : await prompt.text('Project directory', 'vidact-app'))

    let template = parsed.template
    if (template === undefined && prompt !== undefined) {
      template = await prompt.choice(
        'Which template do you want?',
        templates.map(({ name, title, description }) => ({ value: name, title, description })),
        defaultTemplate,
      )
    }

    let shouldInstall = parsed.install
    if (shouldInstall === undefined) {
      shouldInstall =
        prompt === undefined ? false : await prompt.confirm('Install dependencies?', true)
    }

    let shouldInitializeGit = parsed.git
    if (shouldInitializeGit === undefined) {
      shouldInitializeGit =
        prompt === undefined ? false : await prompt.confirm('Initialize a git repository?', true)
    }

    const packageManager: PackageManager =
      parsed.packageManager ?? (await resolvePackageManager(options.cwd))
    const target = path.resolve(options.cwd, directory)
    const basename = path.basename(target)
    const projectName = isValidPackageName(basename) ? basename : toPackageName(basename)

    const result = await scaffold({
      directory: target,
      projectName,
      template: template ?? defaultTemplate,
      vidactVersion: options.version,
    })

    reporter.success(`Created ${projectName} in ${result.directory}`)
    reporter.note('Files', result.files.join('\n'))

    if (shouldInitializeGit) {
      await step(reporter, 'Initializing a git repository', async () => {
        const execute = options.execute ?? spawnProcess
        const { code } = await execute('git', ['init'], target)
        if (code !== 0) throw new Error(`git init exited with code ${code}`)
      })
    }

    if (shouldInstall) {
      await step(reporter, `Installing dependencies with ${packageManager}`, async () => {
        await (options.install ?? installWithPackageManager)({ cwd: target, packageManager })
      })
    }

    const relative = path.relative(options.cwd, target)
    const nextSteps = [
      ...(relative.length > 0 ? [`cd ${relative}`] : []),
      ...(shouldInstall ? [] : [installCommand(packageManager)]),
      runCommand(packageManager, 'dev'),
    ]
    reporter.note('Next steps', nextSteps.join('\n'))
    reporter.outro('Happy building.')
    return 0
  } catch (error) {
    if (error instanceof CliCancelledError) {
      reporter.error('Cancelled.')
      return 130
    }
    if (!(error instanceof CliError)) throw error
    reporter.error(error.message)
    return 1
  }
}

/** A failed side step leaves a usable project behind, so it warns instead of failing the run. */
async function step(reporter: Reporter, label: string, work: () => Promise<void>): Promise<void> {
  try {
    await reporter.task(label, work)
  } catch (error) {
    reporter.warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
