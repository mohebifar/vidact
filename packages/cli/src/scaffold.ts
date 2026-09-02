import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { CliError } from './errors.ts'
import { assertValidPackageName } from './package-name.ts'
import { findTemplate, templatesDirectory } from './templates.ts'

export interface ScaffoldRequest {
  readonly directory: string
  readonly projectName: string
  readonly template: string
  readonly vidactVersion: string
}

export interface ScaffoldResult {
  readonly directory: string
  readonly files: readonly string[]
}

const dotfilePrefix = '_'

export function renderTemplateFile(source: string, values: Record<string, string>): string {
  return source.replaceAll(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match)
}

// A single leading underscore stands in for a dot, because npm never publishes real dotfiles.
// Route files such as `__root.tsx` keep their doubled underscore.
export function toOutputName(templateName: string): string {
  return templateName.startsWith(dotfilePrefix) &&
    !templateName.startsWith(`${dotfilePrefix}${dotfilePrefix}`)
    ? `.${templateName.slice(dotfilePrefix.length)}`
    : templateName
}

export async function isEmptyDirectory(directory: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
  return entries.every((entry) => entry === '.git')
}

export async function scaffold(request: ScaffoldRequest): Promise<ScaffoldResult> {
  const template = findTemplate(request.template)
  if (template === undefined) throw new CliError(`unknown template "${request.template}"`)
  assertValidPackageName(request.projectName)

  const directory = path.resolve(request.directory)
  if (!(await isEmptyDirectory(directory))) {
    throw new CliError(`${directory} is not empty`)
  }

  const templateRoot = path.join(templatesDirectory, template.name)
  const values = {
    projectName: request.projectName,
    vidactVersion: request.vidactVersion,
  }

  const entries = await readdir(templateRoot, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile())
  const written = await Promise.all(
    files.map(async (entry) => {
      const sourcePath = path.join(entry.parentPath, entry.name)
      const relativePath = path
        .relative(templateRoot, sourcePath)
        .split(path.sep)
        .map((segment) => toOutputName(segment))
        .join(path.sep)
      const targetPath = path.join(directory, relativePath)
      await mkdir(path.dirname(targetPath), { recursive: true })
      await writeFile(targetPath, renderTemplateFile(await readFile(sourcePath, 'utf8'), values))
      return relativePath
    }),
  )

  return { directory, files: written.toSorted((left, right) => left.localeCompare(right)) }
}
