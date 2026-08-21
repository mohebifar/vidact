import fs from 'node:fs'
import path from 'node:path'
import { transformWithOxc, type Plugin } from 'vite'
import { analyzeWithCompiler, type VidactAnalysis } from './compiler-client.ts'

const REACT_MODULE = '\0vidact:react'

export interface VidactPluginOptions {
  /** Path to the Rust workspace Cargo.toml. Relative paths resolve from Vite's root. */
  readonly manifestPath?: string
}

export function vidact(options: VidactPluginOptions = {}): Plugin {
  let manifestPath = ''
  const analysisCache = new Map<string, { source: string; analysis: VidactAnalysis }>()

  return {
    name: 'vidact',
    enforce: 'pre',
    configResolved(config) {
      manifestPath = options.manifestPath === undefined
        ? findWorkspaceManifest(config.root)
        : path.resolve(config.root, options.manifestPath)
    },
    resolveId(source) {
      return source === 'react' ? REACT_MODULE : null
    },
    load(id) {
      return id === REACT_MODULE ? 'export { useState } from "@vidact/runtime"' : null
    },
    async transform(source, id) {
      const filename = id.split('?', 1)[0] ?? id
      if (!filename.endsWith('.tsx') || filename.includes('/node_modules/')) return null

      const cached = analysisCache.get(filename)
      let analysis = cached?.source === source ? cached.analysis : undefined
      if (analysis === undefined) {
        analysis = await analyzeWithCompiler(source, filename, manifestPath)
        analysisCache.set(filename, { source, analysis })
      }

      const transformed = await transformWithOxc(source, filename, {
        lang: 'tsx',
        jsx: {
          runtime: 'automatic',
          importSource: '@vidact/runtime',
        },
        sourcemap: true,
        target: 'es2022',
      })
      return {
        code: transformed.code,
        ...(transformed.map === undefined ? {} : { map: transformed.map }),
        meta: { vidact: analysis },
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

export type { VidactAnalysis, VidactComponentAnalysis } from './compiler-client.ts'
