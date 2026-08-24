/* oxlint-disable no-underscore-dangle -- Runtime build constants intentionally use reserved global names. */

import fs from 'node:fs'
import path from 'node:path'

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

const REACT_MODULE = '\0vidact:react'
const REACT_DOM_MODULE = '\0vidact:react-dom'
const REACT_DOM_SERVER_MODULE = '\0vidact:react-dom-server'
const REACT_DOM_STATIC_MODULE = '\0vidact:react-dom-static'

export interface VidactPluginOptions {
  /** Path to the Rust workspace Cargo.toml. Relative paths resolve from Vite's root. */
  readonly manifestPath?: string
  /** Prebuilt vidactc executable. Relative paths resolve from Vite's root. */
  readonly compilerPath?: string
  /** Compiler target. Server and hydration targets use separate entry points. */
  readonly target?: VidactTarget
  /** Opt-in semantic feature families. */
  readonly features?: readonly VidactFeature[]
  /** Compatible TSX dependency sources to compile inside node_modules. */
  readonly includeDependencies?: FilterPattern
  /** Source files to leave untouched even when they otherwise match. */
  readonly exclude?: FilterPattern
  /** JSX-bearing file extensions to compile after earlier Vite transforms. */
  readonly extensions?: readonly `.${string}`[]
}

export interface CompilationCacheInput extends VidactCompilerConfiguration {
  readonly source: string
  readonly filename: string
  readonly manifestPath: string
  readonly compilerPath?: string
  readonly environment: string
}

export function compilationCacheKey(input: CompilationCacheInput): string {
  const configuration = normalizeConfiguration(input)
  return JSON.stringify({
    compilerProtocol: VIDACT_COMPILE_PROTOCOL,
    runtimeProtocol: VIDACT_RUNTIME_PROTOCOL,
    manifestPath: input.manifestPath,
    compilerPath: input.compilerPath,
    filename: input.filename,
    environment: input.environment,
    target: configuration.target,
    features: configuration.features,
    source: input.source,
  })
}

export function vidact(options: VidactPluginOptions = {}): Plugin {
  let manifestPath = ''
  let compilerPath: string | undefined
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
      if (Object.keys(define).length === 0) return
      return {
        define,
      }
    },
    configResolved(config) {
      manifestPath =
        options.manifestPath === undefined
          ? findWorkspaceManifest(config.root)
          : path.resolve(config.root, options.manifestPath)
      compilerPath =
        options.compilerPath === undefined
          ? undefined
          : path.resolve(config.root, options.compilerPath)
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
            ? `export { ${asyncEnabled ? 'Suspense, lazy, ' : ''}${concurrentExports}${actionExports}${frameworkEnabled ? 'cache, cacheSignal, ' : ''}createContext, use, useCallback, useContext, useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "${frameworkEnabled ? '@vidact/runtime/framework/server' : serverRuntime}"`
            : `export { ${asyncEnabled ? 'Suspense, lazy, ' : ''}${concurrentExports}${actionExports}createContext, use, useCallback, useContext, useEffect, useEffectEvent, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "${clientRuntime}"`
        const exports = [core]
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
      if (
        !extensions.some((extension) => filename.endsWith(extension)) ||
        !includeSource(filename) ||
        (filename.includes('/node_modules/') && !includeDependency(filename))
      ) {
        return null
      }

      const cacheKey = compilationCacheKey({
        source,
        filename,
        manifestPath,
        environment: this.environment.name,
        ...(compilerPath === undefined ? {} : { compilerPath }),
        ...configuration,
      })
      let compilation = compilationCache.get(cacheKey)
      if (compilation === undefined) {
        const result = await compileWithCompiler(
          source,
          filename,
          manifestPath,
          configuration,
          compilerPath === undefined ? {} : { compilerPath },
        )
        compilation = {
          code: result.code,
          sourceMap: result.sourceMap,
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

function findWorkspaceManifest(start: string): string {
  let directory = path.resolve(start)
  while (true) {
    const candidate = path.join(directory, 'Cargo.toml')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error(`could not find a Cargo.toml above Vite root ${start}`)
    }
    directory = parent
  }
}

export type {
  VidactAnalysis,
  VidactCompilation,
  VidactComponentAnalysis,
  VidactCompilerConfiguration,
  VidactFeature,
  VidactTarget,
} from './compiler-client.ts'
