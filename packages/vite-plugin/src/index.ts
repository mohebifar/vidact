/* oxlint-disable no-underscore-dangle -- Runtime build constants intentionally use reserved global names. */

import remapping, { type SourceMapInput } from '@jridgewell/remapping'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { createFilter, transformWithOxc, type FilterPattern, type Plugin } from 'vite'

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
  type DependencyCapsule,
} from './dependency-capsule.ts'
import { createDependencyQualifier, isDependencyModuleId } from './dependency-qualification.ts'

const REACT_MODULE = '\0vidact:react'
const REACT_DOM_MODULE = '\0vidact:react-dom'
const REACT_DOM_SERVER_MODULE = '\0vidact:react-dom-server'
const REACT_DOM_STATIC_MODULE = '\0vidact:react-dom-static'

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
  const legacyOptions = options as VidactPluginOptions & {
    readonly compilerPath?: unknown
    readonly manifestPath?: unknown
  }
  if (legacyOptions.compilerPath !== undefined || legacyOptions.manifestPath !== undefined) {
    throw new Error(
      '`compilerPath` and `manifestPath` were removed; install @vidact/compiler for the current platform',
    )
  }
  const configuration = normalizeConfiguration({
    target: options.target ?? 'client',
    features: options.features ?? [],
  })
  const compilationCache = new Map<
    string,
    { code: string; sourceMap: Record<string, unknown>; analysis: VidactAnalysis }
  >()
  const includeDependency =
    options.includeDependencies === undefined
      ? () => false
      : createFilter(options.includeDependencies)
  const includeSource = createFilter(undefined, options.exclude)
  const extensions = options.extensions ?? ['.tsx']
  const dependencyQualifier = createDependencyQualifier()
  const dependencyCapsules = createDependencyCapsuleBuilder()
  let capsuleDefines: Record<string, string> = {}

  return {
    name: 'vidact',
    enforce: 'pre',
    config(config, environment) {
      const define: Record<string, string> = {}
      if (config.define?.__VIDACT_DEV__ === undefined) {
        define.__VIDACT_DEV__ = JSON.stringify(environment.mode !== 'production')
      }
      if (config.define?.__VIDACT_UNSAFE_HTML__ === undefined) {
        define.__VIDACT_UNSAFE_HTML__ = JSON.stringify(
          configuration.features.includes('unsafe-html'),
        )
      }
      if (config.define?.__VIDACT_RETAINED_UI__ === undefined) {
        define.__VIDACT_RETAINED_UI__ = 'false'
      }
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
    resolveId(source) {
      if (source === 'react') return REACT_MODULE
      if (source === 'react-dom') return REACT_DOM_MODULE
      if (source === 'react-dom/server') return REACT_DOM_SERVER_MODULE
      return source === 'react-dom/static' ? REACT_DOM_STATIC_MODULE : null
    },
    load(id) {
      if (id === REACT_MODULE) {
        const asyncEnabled = configuration.features.includes('async')
        const concurrentEnabled = configuration.features.includes('concurrent')
        const actionsEnabled = configuration.features.includes('actions')
        const retainedUiEnabled = configuration.features.includes('retained-ui')
        const profilingEnabled = configuration.features.includes('profiling')
        const frameworkEnabled = configuration.features.includes('framework')
        const clientRuntime = clientRuntimeEntry(
          asyncEnabled,
          concurrentEnabled,
          actionsEnabled,
          configuration.target === 'hydrate',
        )
        const serverRuntime = serverRuntimeEntry(asyncEnabled, concurrentEnabled, actionsEnabled)
        const concurrentExports = concurrentEnabled
          ? 'startTransition, useDeferredValue, useTransition, '
          : ''
        const actionExports = actionsEnabled ? 'useActionState, useOptimistic, ' : ''
        const core =
          configuration.target === 'server'
            ? `export { ${asyncEnabled ? 'Suspense, lazy, ' : ''}${concurrentExports}${actionExports}${frameworkEnabled ? 'cache, cacheSignal, ' : ''}cloneRenderable as cloneElement, createContext, createElement, isRenderable as isValidElement, use, useCallback, useContext, useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "${frameworkEnabled ? '@vidact/runtime/framework/server' : serverRuntime}"`
            : `export { ${asyncEnabled ? 'Suspense, lazy, ' : ''}${concurrentExports}${actionExports}cloneRenderable as cloneElement, createContext, createReactElement as createElement, isRenderable as isValidElement, use, useCallback, useContext, useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "${clientRuntime}"`
        const exports = [core, 'export const version = "19.2.0"']
        if (retainedUiEnabled) {
          const retainedRuntime =
            configuration.target === 'server'
              ? '@vidact/runtime/retained-ui/server'
              : configuration.target === 'hydrate'
                ? '@vidact/runtime/retained-ui/hydrate'
                : '@vidact/runtime/retained-ui'
          exports.push(`export { Activity } from "${retainedRuntime}"`)
        }
        if (profilingEnabled) {
          const profilingRuntime =
            configuration.target === 'server'
              ? '@vidact/runtime/profiling/server'
              : configuration.target === 'hydrate'
                ? '@vidact/runtime/profiling/hydrate'
                : '@vidact/runtime/profiling'
          exports.push(
            `export { Profiler, captureOwnerStack, useDebugValue } from "${profilingRuntime}"`,
          )
        }
        return exports.join('\n')
      }
      const actionsEnabled = configuration.features.includes('actions')
      const concurrentEnabled = configuration.features.includes('concurrent')
      const frameworkEnabled = configuration.features.includes('framework')
      if (id === REACT_DOM_SERVER_MODULE) {
        if (configuration.target !== 'server') {
          return 'throw new Error("react-dom/server requires the server target")'
        }
        const core = `export { renderToStaticMarkup, renderToString } from "${serverRuntimeEntry(configuration.features.includes('async'), concurrentEnabled, actionsEnabled)}"`
        return frameworkEnabled
          ? `${core}\nexport { renderToPipeableStream, renderToReadableStream, resume, resumeToPipeableStream } from "@vidact/runtime/framework/server"`
          : core
      }
      if (id === REACT_DOM_STATIC_MODULE) {
        if (!frameworkEnabled || configuration.target !== 'server') {
          return 'throw new Error("react-dom/static requires the server target and framework feature")'
        }
        return 'export { prerender, prerenderToNodeStream } from "@vidact/runtime/framework/server"'
      }
      if (id !== REACT_DOM_MODULE) return null
      const core =
        configuration.target === 'server'
          ? `export { createPortal${concurrentEnabled ? ', flushSync' : ''}${actionsEnabled ? ', useFormStatus' : ''} } from "${serverRuntimeEntry(configuration.features.includes('async'), concurrentEnabled, actionsEnabled)}"`
          : `export { createPortal${concurrentEnabled ? ', flushSync' : ''}${actionsEnabled ? ', useFormStatus' : ''} } from "${clientRuntimeEntry(configuration.features.includes('async'), concurrentEnabled, actionsEnabled, configuration.target === 'hydrate')}"`
      if (!frameworkEnabled) return core
      const frameworkRuntime =
        configuration.target === 'server'
          ? '@vidact/runtime/framework/server'
          : configuration.target === 'hydrate'
            ? '@vidact/runtime/framework/hydrate'
            : '@vidact/runtime/framework'
      return `${core}\nexport { preconnect, prefetchDNS, preinit, preinitModule, preload, preloadModule } from "${frameworkRuntime}"`
    },
    async transform(source, id) {
      const filename = id.split('?', 1)[0] ?? id
      if (!includeSource(filename)) return null
      const dependencyModule = isDependencyModuleId(filename)
      if (
        dependencyModule
          ? !isDependencyCapsuleModule(filename)
          : !extensions.some((extension) => filename.endsWith(extension))
      ) {
        return null
      }

      let capsule: DependencyCapsule | undefined
      if (dependencyModule) {
        const qualification = await dependencyQualifier.qualify(filename, {
          includeOverride: includeDependency(filename),
        })
        if (qualification?.status !== 'candidate') return null
        if (
          qualification.realModulePath === undefined ||
          qualification.manifestPath === undefined ||
          qualification.packageRoot === undefined
        ) {
          throw new Error(
            `React dependency ${qualification.packageName} is missing capsule metadata`,
          )
        }
        capsule = await dependencyCapsules.build({
          source,
          environment: this.environment.name,
          defines: capsuleDefines,
          qualification: {
            ...qualification,
            status: 'candidate',
            realModulePath: qualification.realModulePath,
            manifestPath: qualification.manifestPath,
            packageRoot: qualification.packageRoot,
            packageName: qualification.packageName ?? 'unknown-package',
          },
          ...configuration,
        })
        for (const contributor of capsule.contributors) this.addWatchFile(contributor)
      }

      const compilationSource = capsule?.code ?? source

      const cacheKey = compilationCacheKey({
        source: capsule?.fingerprint ?? compilationSource,
        filename,
        environment: this.environment.name,
        ...configuration,
      })
      let compilation = compilationCache.get(cacheKey)
      if (compilation === undefined) {
        let result
        try {
          result = await compileWithCompiler(
            compilationSource,
            filename,
            capsule === undefined
              ? configuration
              : {
                  ...configuration,
                  features: [...configuration.features, 'dependency-source'],
                },
          )
        } catch (error) {
          if (capsule === undefined) throw error
          throw dependencyCompilationError(capsule, configuration.target, error)
        }
        compilation = {
          code: result.code,
          sourceMap:
            capsule === undefined
              ? result.sourceMap
              : composeSourceMaps(result.sourceMap, capsule.sourceMap),
          analysis: result.analysis,
        }
        compilationCache.set(cacheKey, compilation)
      }

      const transformed = await transformWithOxc(
        compilation.code,
        filename,
        {
          lang: 'tsx',
          jsx: {
            runtime: 'automatic',
            importSource:
              configuration.target === 'server'
                ? '@vidact/runtime/server'
                : configuration.target === 'hydrate'
                  ? '@vidact/runtime/hydrate'
                  : '@vidact/runtime',
          },
          sourcemap: true,
          target: 'es2022',
        },
        compilation.sourceMap,
      )
      return {
        code: transformed.code,
        ...(transformed.map === undefined ? {} : { map: transformed.map }),
        meta: { vidact: compilation.analysis },
      }
    },
  }
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

function dependencyCompilationError(
  capsule: DependencyCapsule,
  target: VidactTarget,
  cause: unknown,
): Error {
  const identity = `${capsule.packageName}${capsule.packageVersion === undefined ? '' : `@${capsule.packageVersion}`}`
  const detail = cause instanceof Error ? cause.message : String(cause)
  const originalLocation = dependencyOriginalLocation(detail, capsule.sourceMap)
  return new Error(
    `Cannot compile React dependency ${identity} for ${target} from ${capsule.entry}${originalLocation === undefined ? '' : ` (original ${originalLocation})`}: ${detail}`,
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

function clientRuntimeEntry(
  asyncEnabled: boolean,
  concurrentEnabled: boolean,
  actionsEnabled: boolean,
  hydrate: boolean,
) {
  const family = actionsEnabled
    ? asyncEnabled
      ? '/async/actions'
      : '/actions'
    : asyncEnabled
      ? concurrentEnabled
        ? '/async/concurrent'
        : '/async'
      : concurrentEnabled
        ? '/concurrent'
        : ''
  return `@vidact/runtime${family}${hydrate ? '/hydrate' : ''}`
}

function serverRuntimeEntry(
  asyncEnabled: boolean,
  concurrentEnabled: boolean,
  actionsEnabled: boolean,
) {
  if (actionsEnabled && asyncEnabled) return '@vidact/runtime/async/actions/server'
  if (actionsEnabled) return '@vidact/runtime/actions/server'
  if (asyncEnabled && concurrentEnabled) return '@vidact/runtime/async/concurrent/server'
  if (asyncEnabled) return '@vidact/runtime/async/server'
  if (concurrentEnabled) return '@vidact/runtime/concurrent/server'
  return '@vidact/runtime/server'
}

export type {
  VidactAnalysis,
  VidactCompilation,
  VidactComponentAnalysis,
  VidactCompilerConfiguration,
  VidactFeature,
  VidactTarget,
} from './compiler-client.ts'
