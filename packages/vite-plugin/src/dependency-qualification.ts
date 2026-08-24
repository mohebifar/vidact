import { readFile, realpath } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'

type DependencyMap = Readonly<Record<string, string | undefined>>

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: DependencyMap
  readonly peerDependencies?: DependencyMap
  readonly optionalDependencies?: DependencyMap
  readonly peerDependenciesMeta?: Readonly<
    Record<string, { readonly optional?: boolean } | undefined>
  >
}

export type DependencyQualificationReason =
  | 'react-metadata'
  | 'include-override'
  | 'exclude-override'
  | 'no-react-metadata'

export interface DependencyQualification {
  readonly status: 'candidate' | 'ordinary' | 'excluded'
  readonly reason: DependencyQualificationReason
  readonly modulePath: string
  readonly realModulePath?: string
  readonly manifestPath?: string
  readonly packageRoot?: string
  readonly packageName?: string
  readonly packageVersion?: string
}

export interface DependencyQualificationOverrides {
  readonly includeOverride?: boolean
  readonly excludeOverride?: boolean
}

export class DependencyQualificationError extends Error {
  readonly packageName: string
  readonly modulePath: string
  readonly manifestPath?: string

  constructor(
    message: string,
    options: {
      readonly packageName: string
      readonly modulePath: string
      readonly manifestPath?: string
      readonly cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'DependencyQualificationError'
    this.packageName = options.packageName
    this.modulePath = options.modulePath
    this.manifestPath = options.manifestPath
  }
}

interface LocatedManifest {
  readonly manifest: PackageManifest
  readonly manifestPath: string
  readonly packageRoot: string
}

export interface DependencyQualifier {
  qualify(
    moduleId: string,
    overrides?: DependencyQualificationOverrides,
  ): Promise<DependencyQualification | null>
}

export function createDependencyQualifier(): DependencyQualifier {
  const manifestCache = new Map<string, Promise<PackageManifest>>()

  return {
    async qualify(moduleId, overrides = {}) {
      const modulePath = cleanModuleId(moduleId)
      const packageName = packageNameFromNodeModulesPath(modulePath)
      if (packageName === undefined) return null
      if (overrides.excludeOverride === true) {
        return {
          status: 'excluded',
          reason: 'exclude-override',
          modulePath,
          packageName,
        }
      }

      let realModulePath: string
      try {
        realModulePath = await realpath(modulePath)
      } catch (error) {
        throw qualificationError(packageName, modulePath, undefined, 'cannot resolve module', error)
      }

      const located = await findOwningManifest(
        realModulePath,
        packageName,
        modulePath,
        manifestCache,
      )
      const candidate = overrides.includeOverride === true || declaresReact(located.manifest)
      return {
        status: candidate ? 'candidate' : 'ordinary',
        reason:
          overrides.includeOverride === true
            ? 'include-override'
            : candidate
              ? 'react-metadata'
              : 'no-react-metadata',
        modulePath,
        realModulePath,
        manifestPath: located.manifestPath,
        packageRoot: located.packageRoot,
        packageName,
        ...(located.manifest.version === undefined
          ? {}
          : { packageVersion: located.manifest.version }),
      }
    },
  }
}

export function isDependencyModuleId(moduleId: string): boolean {
  return packageNameFromNodeModulesPath(cleanModuleId(moduleId)) !== undefined
}

function cleanModuleId(moduleId: string): string {
  const queryIndex = moduleId.indexOf('?')
  return queryIndex === -1 ? moduleId : moduleId.slice(0, queryIndex)
}

function packageNameFromNodeModulesPath(modulePath: string): string | undefined {
  const normalized = modulePath.replaceAll('\\', '/')
  const marker = '/node_modules/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex === -1) return undefined
  const segments = normalized.slice(markerIndex + marker.length).split('/')
  const first = segments[0]
  if (first === undefined || first.length === 0 || first === '.pnpm') return undefined
  if (!first.startsWith('@')) return first
  const second = segments[1]
  return second === undefined || second.length === 0 ? undefined : `${first}/${second}`
}

async function findOwningManifest(
  realModulePath: string,
  expectedPackageName: string,
  modulePath: string,
  cache: Map<string, Promise<PackageManifest>>,
): Promise<LocatedManifest> {
  let directory = dirname(realModulePath)
  const filesystemRoot = parse(directory).root

  while (true) {
    const manifestPath = resolve(directory, 'package.json')
    try {
      const manifest = await cachedManifest(manifestPath, cache)
      if (manifest.name === expectedPackageName) {
        return { manifest, manifestPath, packageRoot: directory }
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        throw qualificationError(
          expectedPackageName,
          modulePath,
          manifestPath,
          'has an unreadable or malformed owning manifest',
          error,
        )
      }
    }

    if (directory === filesystemRoot) break
    directory = dirname(directory)
  }

  throw qualificationError(
    expectedPackageName,
    modulePath,
    undefined,
    'does not have a readable owning manifest',
  )
}

function cachedManifest(
  manifestPath: string,
  cache: Map<string, Promise<PackageManifest>>,
): Promise<PackageManifest> {
  let manifest = cache.get(manifestPath)
  if (manifest === undefined) {
    manifest = readFile(manifestPath, 'utf8').then(
      (source) => JSON.parse(source) as PackageManifest,
    )
    cache.set(manifestPath, manifest)
  }
  return manifest
}

function declaresReact(manifest: PackageManifest): boolean {
  return [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies].some(
    (dependencies) =>
      dependencies?.react !== undefined || dependencies?.['react-dom'] !== undefined,
  )
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  )
}

function qualificationError(
  packageName: string,
  modulePath: string,
  manifestPath: string | undefined,
  detail: string,
  cause?: unknown,
): DependencyQualificationError {
  return new DependencyQualificationError(
    `Cannot qualify React dependency ${packageName}: ${detail} (${modulePath})`,
    { packageName, modulePath, ...(manifestPath === undefined ? {} : { manifestPath }), cause },
  )
}
