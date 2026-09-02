import { CliError } from './errors.ts'

const packageNamePattern = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && packageNamePattern.test(name)
}

export function toPackageName(directoryName: string): string {
  const normalized = directoryName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9-._~]+/g, '-')
    .replaceAll(/^[-._~]+|[-._~]+$/g, '')
    .slice(0, 214)
  return normalized.length === 0 ? 'vidact-app' : normalized
}

export function assertValidPackageName(name: string): void {
  if (!isValidPackageName(name)) {
    throw new CliError(`"${name}" is not a valid npm package name`)
  }
}
