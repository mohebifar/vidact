import { readFileSync } from 'node:fs'

interface Manifest {
  readonly version: string
}

export function readCliVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as Manifest
  return manifest.version
}
