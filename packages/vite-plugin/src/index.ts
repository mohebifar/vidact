/* oxlint-disable no-underscore-dangle -- Runtime build constants intentionally use reserved global names. */

import remapping, { type SourceMapInput } from '@jridgewell/remapping'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { createFilter, transformWithOxc, type FilterPattern, type Plugin } from 'vite'

import { ReplacementCache } from './compilation-cache.ts'
import {
  compileWithCompiler,
  normalizeConfiguration,
  VIDACT_COMPILE_PROTOCOL,
  VIDACT_RUNTIME_PROTOCOL,
  type VidactAnalysis,
  type VidactCompilerConfiguration,
  type VidactFeature,
  type VidactTarget,
} from './compiler-client.ts'
import {
  createDependencyCapsuleBuilder,
  isDependencyCapsuleModule,
  isDependencyShimId,
  unloweredDependencyShimSource,
  type DependencyCapsule,
  type SourceDependencyCapsule,
} from './dependency-capsule.ts'
import { createDependencyQualifier, isDependencyModuleId } from './dependency-qualification.ts'
import { loadReactModule, resolveReactModuleId } from './react-modules.ts'

/**
 * Rolldown emits shared interop helpers into this virtual module. Capsule code carries the id as
 * text, so it is rewritten to a sanitized specifier on the way out and mapped back on resolve.
 */
const ROLLDOWN_RUNTIME_MODULE = '\0rolldown/runtime.js'
const SANITIZED_ROLLDOWN_RUNTIME_MODULE = 'vidact:rolldown/runtime.js'
const VIDACT_DEPENDENCY_RUNTIME_MODULE = '\0vidact:dependency-runtime'

const REACT_IMPORT_PATTERN = /^(?:react|react-dom)(?:\/|$)/
const MODULE_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'";()]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

export interface VidactPluginOptions {
  /** Compiler target. Server and hydration targets use separate entry points. */
  readonly target?: VidactTarget
  /** Opt-in semantic feature families. */
  readonly features?: readonly VidactFeature[]
  /** Additional dependency sources to consider when React metadata is absent. */
  readonly includeDependencies?: FilterPattern
  /** Source files to leave untouched even when they otherwise match. */
  readonly exclude?: FilterPattern
  /** JSX-bearing file extensions to compile after earlier Vite transforms. */
  readonly extensions?: readonly `.${string}`[]
}

export interface CompilationCacheInput extends VidactCompilerConfiguration {
  readonly source: string
  readonly filename: string
  readonly environment: string
}

interface Compilation {
  readonly code: string
  readonly sourceMap: Record<string, unknown>
  readonly analysis: VidactAnalysis
}

/**
 * A capsule links a module to the pre-bundled React dependencies it needs, so the compiler sees one
 * self-contained source. The subject only labels compilation failures.
 */
interface CapsuleLink {
  readonly capsule: DependencyCapsule | SourceDependencyCapsule
  readonly subject: string
}

/** The slice of the Rollup plugin context the transform helpers below need. */
interface TransformContext {
  readonly environment: { readonly name: string }
  addWatchFile: (id: string) => void
  resolve: (
    source: string,
    importer: string,
    options: { readonly skipSelf: boolean },
  ) => Promise<{ readonly id: string } | null>
}

function compilationCacheSlotKey(input: Omit<CompilationCacheInput, 'source'>): string {
  const configuration = normalizeConfiguration(input)
  return JSON.stringify({
    compilerProtocol: VIDACT_COMPILE_PROTOCOL,
    runtimeProtocol: VIDACT_RUNTIME_PROTOCOL,
    filename: input.filename,
    environment: input.environment,
    target: configuration.target,
    features: configuration.features,
  })
}

export function compilationCacheKey(input: CompilationCacheInput): string {
  const configuration = normalizeConfiguration(input)
  return JSON.stringify({
    compilerProtocol: VIDACT_COMPILE_PROTOCOL,
    runtimeProtocol: VIDACT_RUNTIME_PROTOCOL,
    filename: input.filename,
    environment: input.environment,
    target: configuration.target,
    features: configuration.features,
    source: input.source,
  })
}

export function vidact(options: VidactPluginOptions = {}): Plugin {
  assertNoRemovedOptions(options)

  const configuration = normalizeConfiguration({
    target: options.target ?? 'client',
    features: options.features ?? [],
  })
  const includeDependency =
    options.includeDependencies === undefined
      ? () => false
      : createFilter(options.includeDependencies)
  const includeSource = createFilter(undefined, options.exclude)
  const extensions = options.extensions ?? ['.tsx']

  const compilationCache = new ReplacementCache<Compilation>()
  const dependencyQualifier = createDependencyQualifier()
  const dependencyCapsules = createDependencyCapsuleBuilder()
  /** Capsules whose output references Rolldown's interop helpers, keyed by module filename. */
  const helperBearingCapsules = new Set<string>()
  let capsuleDefines: Record<string, string> = {}

  /** Whether this module is compiled by Vidact at all, and whether it needs a capsule. */
  function transformKind(filename: string): 'source' | 'dependency' | undefined {
    if (!includeSource(filename)) return undefined
    if (isDependencyModuleId(filename)) {
      return isDependencyCapsuleModule(filename) ? 'dependency' : undefined
    }
    return extensions.some((extension) => filename.endsWith(extension)) ? 'source' : undefined
  }

  /** Bundles a React dependency into a capsule, or skips a module that does not qualify. */
  async function linkDependencyCapsule(
    context: TransformContext,
    filename: string,
    source: string,
  ): Promise<CapsuleLink | undefined> {
    const qualification = await dependencyQualifier.qualify(filename, {
      includeOverride: includeDependency(filename),
    })
    if (qualification?.status !== 'candidate') return undefined
    const { realModulePath, manifestPath, packageRoot } = qualification
    if (realModulePath === undefined || manifestPath === undefined || packageRoot === undefined) {
      throw new Error(`React dependency ${qualification.packageName} is missing capsule metadata`)
    }
    const capsule = await dependencyCapsules.build({
      source,
      environment: context.environment.name,
      defines: capsuleDefines,
      qualification: {
        ...qualification,
        status: 'candidate',
        realModulePath,
        manifestPath,
        packageRoot,
        packageName: qualification.packageName ?? 'unknown-package',
      },
      ...configuration,
    })
    for (const contributor of capsule.contributors) context.addWatchFile(contributor)
    const version = capsule.packageVersion === undefined ? '' : `@${capsule.packageVersion}`
    return { capsule, subject: `React dependency ${capsule.packageName}${version}` }
  }

  /** Bundles the React dependencies a first-party source file imports, when it has any. */
  async function linkSourceCapsule(
    context: TransformContext,
    filename: string,
    source: string,
  ): Promise<CapsuleLink | undefined> {
    const importsCandidate = await hasCandidateDependencyImport(
      source,
      (specifier) => context.resolve(specifier, filename, { skipSelf: true }),
      dependencyQualifier,
      includeDependency,
    )
    if (!importsCandidate) return undefined
    const capsule = await dependencyCapsules.buildSource({
      source,
      entry: filename,
      environment: context.environment.name,
      defines: capsuleDefines,
      ...configuration,
    })
    if (capsule === undefined) return undefined
    for (const contributor of capsule.contributors) context.addWatchFile(contributor)
    return { capsule, subject: 'source-linked React dependencies' }
  }

  async function compileModule(
    filename: string,
    environment: string,
    source: string,
    link: CapsuleLink | undefined,
  ): Promise<Compilation> {
    const compilationSource = link?.capsule.code ?? source
    const cacheSlot = compilationCacheSlotKey({ filename, environment, ...configuration })
    const sourceRevision = link?.capsule.fingerprint ?? compilationSource
    const cached = compilationCache.get(cacheSlot, sourceRevision)
    if (cached !== undefined) return cached

    let result
    try {
      result = await compileWithCompiler(
        compilationSource,
        filename,
        link === undefined
          ? configuration
          : { ...configuration, features: [...configuration.features, 'dependency-source'] },
      )
    } catch (error) {
      if (link === undefined) throw error
      throw capsuleCompilationError(link, configuration.target, error)
    }

    const compilation: Compilation = {
      code: result.code,
      sourceMap:
        link === undefined
          ? result.sourceMap
          : composeSourceMaps(result.sourceMap, link.capsule.sourceMap),
      analysis: result.analysis,
    }
    compilationCache.set(cacheSlot, sourceRevision, compilation)
    return compilation
  }

  return {
    name: 'vidact',
    enforce: 'pre',
    config(config, environment) {
      const define = vidactDefines(config.define, environment.mode, configuration)
      capsuleDefines = {
        ...config.define,
        ...define,
        'process.env.NODE_ENV': JSON.stringify(environment.mode),
      }
      return {
        ...(Object.keys(define).length === 0 ? {} : { define }),
        ...(config.optimizeDeps?.noDiscovery === undefined
          ? { optimizeDeps: { noDiscovery: true } }
          : {}),
        ...(config.ssr?.noExternal === undefined ? { ssr: { noExternal: true } } : {}),
      }
    },
    async handleHotUpdate(context) {
      await Promise.all([
        dependencyCapsules.invalidate(context.file),
        dependencyQualifier.invalidate(context.file),
      ])
    },
    resolveId(source, importer) {
      if (isDependencyShimId(source)) return source
      if (
        (source === ROLLDOWN_RUNTIME_MODULE || source === SANITIZED_ROLLDOWN_RUNTIME_MODULE) &&
        importer !== undefined &&
        helperBearingCapsules.has(importer.split('?', 1)[0] ?? importer)
      ) {
        return VIDACT_DEPENDENCY_RUNTIME_MODULE
      }
      return resolveReactModuleId(source)
    },
    load(id) {
      if (id === VIDACT_DEPENDENCY_RUNTIME_MODULE) return 'export {}'
      return unloweredDependencyShimSource(id) ?? loadReactModule(id, configuration)
    },
    async transform(source, id) {
      const filename = id.split('?', 1)[0] ?? id
      const kind = transformKind(filename)
      if (kind === undefined) return null

      helperBearingCapsules.delete(filename)
      const context = this as unknown as TransformContext
      let link: CapsuleLink | undefined
      if (kind === 'dependency') {
        link = await linkDependencyCapsule(context, filename, source)
        // A dependency without a capsule is not React code Vidact should touch.
        if (link === undefined) return null
      } else {
        link = await linkSourceCapsule(context, filename, source)
      }

      const compilation = await compileModule(filename, context.environment.name, source, link)
      const transformed = await transformWithOxc(
        compilation.code,
        filename,
        {
          lang: 'tsx',
          jsx: { runtime: 'automatic', importSource: jsxImportSource(configuration.target) },
          sourcemap: true,
          target: 'es2022',
        },
        compilation.sourceMap,
      )

      if (link === undefined) {
        return {
          code: transformed.code,
          ...(transformed.map === undefined ? {} : { map: transformed.map }),
          meta: { vidact: compilation.analysis },
        }
      }
      if (referencesRolldownHelpers(transformed.code)) helperBearingCapsules.add(filename)
      return {
        code: sanitizeDependencyVirtualSourceIds(transformed.code),
        ...(transformed.map === undefined ? {} : { map: transformed.map }),
        meta: { vidact: compilation.analysis },
      }
    },
  }
}

function assertNoRemovedOptions(options: VidactPluginOptions): void {
  const legacyOptions = options as VidactPluginOptions & {
    readonly compilerPath?: unknown
    readonly manifestPath?: unknown
  }
  if (legacyOptions.compilerPath !== undefined || legacyOptions.manifestPath !== undefined) {
    throw new Error(
      '`compilerPath` and `manifestPath` were removed; install @vidact/compiler for the current platform',
    )
  }
}

/** Build constants the runtime compiles against, minus any the user already defined. */
function vidactDefines(
  userDefine: Record<string, unknown> | undefined,
  mode: string,
  configuration: VidactCompilerConfiguration,
): Record<string, string> {
  const defaults: Record<string, string> = {
    __VIDACT_DEV__: JSON.stringify(mode !== 'production'),
    __VIDACT_UNSAFE_HTML__: JSON.stringify(configuration.features.includes('unsafe-html')),
    __VIDACT_RETAINED_UI__: 'false',
  }
  return Object.fromEntries(
    Object.entries(defaults).filter(([name]) => userDefine?.[name] === undefined),
  )
}

function jsxImportSource(target: VidactTarget): string {
  if (target === 'server') return '@vidact/runtime/server'
  return target === 'hydrate' ? '@vidact/runtime/hydrate' : '@vidact/runtime'
}

export function sourceDependencySpecifiers(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER_PATTERN)].flatMap((match) => {
    const specifier = match[1] ?? match[2]
    return specifier === undefined ? [] : [specifier]
  })
}

async function hasCandidateDependencyImport(
  source: string,
  resolveModule: (specifier: string) => Promise<{ readonly id: string } | null>,
  qualifier: ReturnType<typeof createDependencyQualifier>,
  includeDependency: (id: string) => boolean,
): Promise<boolean> {
  for (const specifier of sourceDependencySpecifiers(source)) {
    if (REACT_IMPORT_PATTERN.test(specifier) || specifier.startsWith('node:')) continue
    const resolved = await resolveModule(specifier).catch(() => null)
    if (resolved === null || !isDependencyModuleId(resolved.id)) continue
    const qualification = await qualifier.qualify(resolved.id, {
      includeOverride: includeDependency(resolved.id),
    })
    if (qualification?.status === 'candidate') return true
  }
  return false
}

function referencesRolldownHelpers(code: string): boolean {
  return code.includes('\\0rolldown/runtime.js') || code.includes(ROLLDOWN_RUNTIME_MODULE)
}

function sanitizeDependencyVirtualSourceIds(source: string): string {
  return source
    .replaceAll('\\0rolldown/runtime.js', SANITIZED_ROLLDOWN_RUNTIME_MODULE)
    .replaceAll('\0rolldown/runtime.js', SANITIZED_ROLLDOWN_RUNTIME_MODULE)
}

function composeSourceMaps(
  generated: Record<string, unknown>,
  original: Record<string, unknown>,
): Record<string, unknown> {
  return remapping(
    [generated, original] as unknown as SourceMapInput[],
    () => null,
  ) as unknown as Record<string, unknown>
}

function capsuleCompilationError(link: CapsuleLink, target: VidactTarget, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  const originalLocation = dependencyOriginalLocation(detail, link.capsule.sourceMap)
  const origin = originalLocation === undefined ? '' : ` (original ${originalLocation})`
  return new Error(
    `Cannot compile ${link.subject} for ${target} from ${link.capsule.entry}${origin}: ${detail}`,
    { cause },
  )
}

function dependencyOriginalLocation(
  message: string,
  sourceMap: Record<string, unknown>,
): string | undefined {
  const generated = message.match(/:(\d+):(\d+):/)
  if (generated === null) return undefined
  const position = originalPositionFor(new TraceMap(sourceMap as never), {
    line: Number(generated[1]),
    column: Number(generated[2]) - 1,
  })
  return position.source === null || position.line === null || position.column === null
    ? undefined
    : `${position.source}:${String(position.line)}:${String(position.column + 1)}`
}

export type {
  VidactAnalysis,
  VidactCompilation,
  VidactComponentAnalysis,
  VidactCompilerConfiguration,
  VidactFeature,
  VidactTarget,
} from './compiler-client.ts'
