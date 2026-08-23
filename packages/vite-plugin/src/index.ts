/* oxlint-disable no-underscore-dangle -- Runtime build constants intentionally use reserved global names. */

import fs from 'node:fs'
import path from 'node:path'

import { transformWithOxc, type Plugin } from 'vite'

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

export interface VidactPluginOptions {
  /** Path to the Rust workspace Cargo.toml. Relative paths resolve from Vite's root. */
  readonly manifestPath?: string
  /** Compiler target. Server and hydration targets use separate entry points. */
  readonly target?: VidactTarget
  /** Opt-in semantic feature families. */
  readonly features?: readonly VidactFeature[]
}

export interface CompilationCacheInput extends VidactCompilerConfiguration {
  readonly source: string
  readonly filename: string
  readonly manifestPath: string
  readonly environment: string
}

export function compilationCacheKey(input: CompilationCacheInput): string {
  const configuration = normalizeConfiguration(input)
  return JSON.stringify({
    compilerProtocol: VIDACT_COMPILE_PROTOCOL,
    runtimeProtocol: VIDACT_RUNTIME_PROTOCOL,
    manifestPath: input.manifestPath,
    filename: input.filename,
    environment: input.environment,
    target: configuration.target,
    features: configuration.features,
    source: input.source,
  })
}

export function vidact(options: VidactPluginOptions = {}): Plugin {
  let manifestPath = ''
  const configuration = normalizeConfiguration({
    target: options.target ?? 'client',
    features: options.features ?? [],
  })
  const compilationCache = new Map<
    string,
    { code: string; sourceMap: Record<string, unknown>; analysis: VidactAnalysis }
  >()

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
    },
    resolveId(source) {
      return source === 'react' ? REACT_MODULE : null
    },
    load(id) {
      return id === REACT_MODULE
        ? 'export { useImperativeHandle, useRef } from "@vidact/runtime"'
        : null
    },
    async transform(source, id) {
      const filename = id.split('?', 1)[0] ?? id
      if (!filename.endsWith('.tsx') || filename.includes('/node_modules/')) return null

      const cacheKey = compilationCacheKey({
        source,
        filename,
        manifestPath,
        environment: this.environment.name,
        ...configuration,
      })
      let compilation = compilationCache.get(cacheKey)
      if (compilation === undefined) {
        const result = await compileWithCompiler(source, filename, manifestPath, configuration)
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
            importSource: '@vidact/runtime',
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
