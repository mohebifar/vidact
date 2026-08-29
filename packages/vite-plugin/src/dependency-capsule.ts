import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'

import { rolldown, type OutputChunk } from 'rolldown'

import type { VidactCompilerConfiguration } from './compiler-client.ts'
import {
  createDependencyQualifier,
  isDependencyModuleId,
  type DependencyQualification,
} from './dependency-qualification.ts'

const REACT_EXTERNAL = /^(?:react|react-dom)(?:\/|$)/

export interface DependencyCapsuleInput extends VidactCompilerConfiguration {
  readonly source: string
  readonly environment: string
  readonly defines: Readonly<Record<string, string>>
  readonly qualification: DependencyQualification & {
    readonly status: 'candidate'
    readonly realModulePath: string
    readonly manifestPath: string
    readonly packageRoot: string
    readonly packageName: string
  }
}

export interface SourceDependencyCapsuleInput extends VidactCompilerConfiguration {
  readonly source: string
  readonly entry: string
  readonly environment: string
  readonly defines: Readonly<Record<string, string>>
}

export interface DependencyCapsule {
  readonly code: string
  readonly sourceMap: Record<string, unknown>
  readonly contributors: readonly string[]
  readonly fingerprint: string
  readonly packageName: string
  readonly packageVersion?: string
  readonly entry: string
}

export interface SourceDependencyCapsule {
  readonly code: string
  readonly sourceMap: Record<string, unknown>
  readonly contributors: readonly string[]
  readonly fingerprint: string
  readonly entry: string
}

export interface DependencyCapsuleBuilder {
  build(input: DependencyCapsuleInput): Promise<DependencyCapsule>
  buildSource(input: SourceDependencyCapsuleInput): Promise<SourceDependencyCapsule | undefined>
  invalidate(filename: string): Promise<void>
}

export function createDependencyCapsuleBuilder(): DependencyCapsuleBuilder {
  const cache = new Map<string, Promise<DependencyCapsule>>()
  const sourceCache = new Map<string, Promise<SourceDependencyCapsule | undefined>>()
  const contributorKeys = new Map<string, Set<string>>()

  return {
    build(input) {
      const key = capsuleInputKey(input)
      let capsule = cache.get(key)
      if (capsule === undefined) {
        capsule = buildDependencyCapsule(input).then(
          (result) => {
            for (const contributor of result.contributors) {
              let keys = contributorKeys.get(contributor)
              if (keys === undefined) {
                keys = new Set()
                contributorKeys.set(contributor, keys)
              }
              keys.add(key)
            }
            return result
          },
          (error: unknown) => {
            cache.delete(key)
            throw error
          },
        )
        cache.set(key, capsule)
      }
      return capsule
    },
    buildSource(input) {
      const key = sourceCapsuleInputKey(input)
      let capsule = sourceCache.get(key)
      if (capsule === undefined) {
        capsule = buildSourceDependencyCapsule(input).then(
          (result) => {
            if (result !== undefined) {
              for (const contributor of result.contributors) {
                let keys = contributorKeys.get(contributor)
                if (keys === undefined) {
                  keys = new Set()
                  contributorKeys.set(contributor, keys)
                }
                keys.add(key)
              }
            }
            return result
          },
          (error: unknown) => {
            sourceCache.delete(key)
            throw error
          },
        )
        sourceCache.set(key, capsule)
      }
      return capsule
    },
    async invalidate(filename) {
      const normalized = await realpath(filename).catch(() => filename)
      const keys = contributorKeys.get(normalized)
      if (keys === undefined) return
      for (const key of keys) {
        cache.delete(key)
        sourceCache.delete(key)
      }
      contributorKeys.delete(normalized)
    },
  }
}

export async function buildSourceDependencyCapsule(
  input: SourceDependencyCapsuleInput,
): Promise<SourceDependencyCapsule | undefined> {
  const qualifier = createDependencyQualifier()
  const manifests = new Set<string>()
  const linkedModules = new Set<string>()
  const bundle = await rolldown({
    input: input.entry,
    tsconfig: false,
    transform: { define: { ...input.defines }, jsx: 'preserve' },
    external: (specifier) => REACT_EXTERNAL.test(specifier) || specifier.startsWith('node:'),
    plugins: [
      {
        name: 'vidact-source-capsule-resolution',
        async resolveId(specifier, importer) {
          if (
            importer === undefined ||
            REACT_EXTERNAL.test(specifier) ||
            specifier.startsWith('node:')
          ) {
            return null
          }
          const resolved = await this.resolve(specifier, importer, { skipSelf: true })
          if (resolved === null || !isDependencyModuleId(resolved.id)) {
            return { id: specifier, external: true }
          }
          const qualification = await qualifier.qualify(resolved.id)
          if (qualification?.status !== 'candidate') {
            return {
              id: importer === input.entry ? specifier : resolved.id,
              external: true,
            }
          }
          linkedModules.add(qualification.realModulePath ?? resolved.id)
          if (qualification.manifestPath !== undefined) manifests.add(qualification.manifestPath)
          return resolved
        },
      },
      {
        name: 'vidact-source-capsule-entry',
        resolveId(id) {
          return id === input.entry ? id : null
        },
        load(id) {
          return id === input.entry
            ? { code: input.source, moduleType: sourceModuleType(input.entry) }
            : null
        },
      },
    ],
    treeshake: true,
  })

  try {
    const generated = await bundle.generate({
      format: 'esm',
      sourcemap: true,
      codeSplitting: false,
      exports: 'named',
    })
    if (linkedModules.size === 0) return undefined
    const chunks = generated.output.filter(
      (output): output is OutputChunk => output.type === 'chunk',
    )
    if (chunks.length !== 1) {
      throw new Error(
        `source dependency capsule produced ${String(chunks.length)} chunks; dynamic package graphs are unsupported`,
      )
    }
    const chunk = chunks[0]!
    if (chunk.map === null) {
      throw new Error('source dependency capsule did not produce a source map')
    }
    const contributors = [...new Set([...chunk.moduleIds, ...manifests])].toSorted()
    const sourceMap = JSON.parse(chunk.map.toString()) as Record<string, unknown>
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          code: chunk.code,
          sourceMap,
          environment: input.environment,
          target: input.target,
          features: [...input.features].toSorted(),
          defines: Object.entries(input.defines).toSorted(([left], [right]) =>
            left.localeCompare(right),
          ),
        }),
      )
      .digest('hex')

    return {
      code: chunk.code,
      sourceMap,
      contributors,
      fingerprint,
      entry: input.entry,
    }
  } finally {
    await bundle.close()
  }
}

export async function buildDependencyCapsule(
  input: DependencyCapsuleInput,
): Promise<DependencyCapsule> {
  const manifestSource = await readFile(input.qualification.manifestPath, 'utf8')
  const entry = input.qualification.realModulePath
  const qualifier = createDependencyQualifier()
  const manifests = new Set([input.qualification.manifestPath])
  const bundle = await rolldown({
    input: entry,
    transform: { define: { ...input.defines } },
    external: (specifier) => REACT_EXTERNAL.test(specifier) || specifier.startsWith('node:'),
    plugins: [
      {
        name: 'vidact-capsule-resolution',
        async resolveId(specifier, importer) {
          if (
            importer === undefined ||
            REACT_EXTERNAL.test(specifier) ||
            specifier.startsWith('node:')
          ) {
            return null
          }
          const resolved = await this.resolve(specifier, importer, { skipSelf: true })
          if (resolved === null || !isDependencyModuleId(resolved.id)) return resolved
          const qualification = await qualifier.qualify(resolved.id)
          if (qualification?.status === 'candidate') {
            if (qualification.manifestPath !== undefined) manifests.add(qualification.manifestPath)
            return resolved
          }
          return { id: specifier, external: true }
        },
      },
      {
        name: 'vidact-capsule-entry',
        load(id) {
          return id === entry ? { code: input.source, moduleType: moduleType(entry) } : null
        },
      },
    ],
    treeshake: true,
  })

  try {
    const generated = await bundle.generate({
      format: 'esm',
      sourcemap: true,
      codeSplitting: false,
      exports: 'named',
    })
    const chunks = generated.output.filter(
      (output): output is OutputChunk => output.type === 'chunk',
    )
    if (chunks.length !== 1) {
      throw new Error(
        `dependency capsule produced ${String(chunks.length)} chunks; dynamic package graphs are unsupported`,
      )
    }
    const chunk = chunks[0]!
    if (chunk.map === null) {
      throw new Error('dependency capsule did not produce a source map')
    }
    const contributors = [...new Set([...chunk.moduleIds, ...manifests])].toSorted()
    const sourceMap = JSON.parse(chunk.map.toString()) as Record<string, unknown>
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          code: chunk.code,
          sourceMap,
          manifestSource,
          environment: input.environment,
          target: input.target,
          features: [...input.features].toSorted(),
          defines: Object.entries(input.defines).toSorted(([left], [right]) =>
            left.localeCompare(right),
          ),
        }),
      )
      .digest('hex')

    return {
      code: chunk.code,
      sourceMap,
      contributors,
      fingerprint,
      packageName: input.qualification.packageName,
      ...(input.qualification.packageVersion === undefined
        ? {}
        : { packageVersion: input.qualification.packageVersion }),
      entry,
    }
  } finally {
    await bundle.close()
  }
}

function capsuleInputKey(input: DependencyCapsuleInput): string {
  return JSON.stringify({
    source: input.source,
    entry: input.qualification.realModulePath,
    manifest: input.qualification.manifestPath,
    environment: input.environment,
    target: input.target,
    features: [...input.features].toSorted(),
    defines: Object.entries(input.defines).toSorted(([left], [right]) => left.localeCompare(right)),
  })
}

function sourceCapsuleInputKey(input: SourceDependencyCapsuleInput): string {
  return JSON.stringify({
    source: input.source,
    entry: input.entry,
    environment: input.environment,
    target: input.target,
    features: [...input.features].toSorted(),
    defines: Object.entries(input.defines).toSorted(([left], [right]) => left.localeCompare(right)),
  })
}

function moduleType(filename: string): 'js' | 'jsx' | 'ts' | 'tsx' {
  if (filename.endsWith('.tsx')) return 'tsx'
  if (filename.endsWith('.ts')) return 'ts'
  if (filename.endsWith('.jsx')) return 'jsx'
  return 'js'
}

function sourceModuleType(filename: string): 'js' | 'jsx' | 'ts' | 'tsx' {
  if (filename.endsWith('.js') || filename.endsWith('.mjs')) return 'js'
  return moduleType(filename) === 'js' ? 'jsx' : moduleType(filename)
}

export function isDependencyCapsuleModule(filename: string): boolean {
  return (
    isDependencyModuleId(filename) &&
    ['.js', '.mjs', '.jsx', '.ts', '.tsx'].some((extension) => filename.endsWith(extension))
  )
}
