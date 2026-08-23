import { spawn } from 'node:child_process'
import path from 'node:path'

import { VIDACT_RUNTIME_PROTOCOL } from '@vidact/runtime/protocol'

export const VIDACT_COMPILE_PROTOCOL = 'vidact-compile-v2'
export { VIDACT_RUNTIME_PROTOCOL }

export type VidactTarget = 'client' | 'hydrate' | 'server'
export type VidactFeature =
  | 'unsafe-html'
  | 'async'
  | 'concurrent'
  | 'actions'
  | 'css-insertion'
  | 'retained-ui'
  | 'profiling'
  | 'framework'

export interface VidactCompilerConfiguration {
  readonly target: VidactTarget
  readonly features: readonly VidactFeature[]
}

export interface VidactAnalysis {
  readonly protocol: 'vidact-analysis-v1'
  readonly components: readonly VidactComponentAnalysis[]
}

export interface VidactComponentAnalysis {
  readonly name: string
  readonly span?: {
    readonly start: number
    readonly end: number
  }
  readonly sources: readonly {
    readonly id: number
    readonly name: string
    readonly kind: string
  }[]
  readonly updaters: readonly {
    readonly id: number
    readonly kind: string
    readonly reads: readonly number[]
    readonly writes: readonly number[]
  }[]
}

export interface VidactCompilation {
  readonly protocol: typeof VIDACT_COMPILE_PROTOCOL
  readonly runtimeProtocol: typeof VIDACT_RUNTIME_PROTOCOL
  readonly configuration: VidactCompilerConfiguration
  readonly code: string
  readonly sourceMap: Record<string, unknown>
  readonly analysis: VidactAnalysis
}

export function analyzeWithCompiler(
  source: string,
  filename: string,
  manifestPath: string,
  configuration: VidactCompilerConfiguration = { target: 'client', features: [] },
): Promise<VidactAnalysis> {
  return runCompiler('analyze', source, filename, manifestPath, configuration).then((result) => {
    const analysis = result as Partial<VidactAnalysis>
    if (analysis.protocol !== 'vidact-analysis-v1' || !Array.isArray(analysis.components)) {
      throw new Error('vidactc returned an unsupported analysis protocol')
    }
    return analysis as VidactAnalysis
  })
}

export function compileWithCompiler(
  source: string,
  filename: string,
  manifestPath: string,
  configuration: VidactCompilerConfiguration = { target: 'client', features: [] },
): Promise<VidactCompilation> {
  const normalizedConfiguration = normalizeConfiguration(configuration)
  return runCompiler('compile', source, filename, manifestPath, normalizedConfiguration).then(
    (result) => {
      const compilation = result as Partial<VidactCompilation>
      if (
        compilation.protocol !== VIDACT_COMPILE_PROTOCOL ||
        compilation.runtimeProtocol !== VIDACT_RUNTIME_PROTOCOL ||
        typeof compilation.code !== 'string' ||
        compilation.sourceMap === null ||
        typeof compilation.sourceMap !== 'object' ||
        compilation.analysis?.protocol !== 'vidact-analysis-v1'
      ) {
        throw new Error('vidactc returned an unsupported compilation protocol')
      }
      if (
        compilation.configuration?.target !== normalizedConfiguration.target ||
        JSON.stringify(compilation.configuration.features) !==
          JSON.stringify(normalizedConfiguration.features)
      ) {
        throw new Error('vidactc returned a compilation for different target or feature options')
      }
      return compilation as VidactCompilation
    },
  )
}

export function normalizeConfiguration(
  configuration: VidactCompilerConfiguration,
): VidactCompilerConfiguration {
  return {
    target: configuration.target,
    features: [...new Set(configuration.features)].toSorted(),
  }
}

function runCompiler(
  command: 'analyze' | 'compile',
  source: string,
  filename: string,
  manifestPath: string,
  configuration: VidactCompilerConfiguration,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(
      'cargo',
      [
        'run',
        '--quiet',
        '--manifest-path',
        manifestPath,
        '-p',
        'vidact-compiler',
        '--bin',
        'vidactc',
        '--',
        command,
        '--filename',
        filename,
        '--target',
        configuration.target,
        ...configuration.features.flatMap((feature) => ['--feature', feature]),
      ],
      {
        cwd: path.dirname(manifestPath),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    child.on('error', rejectOnce)
    child.stdin.on('error', rejectOnce)
    child.on('close', (code) => {
      if (settled) return
      settled = true
      const output = Buffer.concat(stdout).toString('utf8').trim()
      const diagnostic = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        reject(new Error(diagnostic || `vidactc exited with status ${String(code)}`))
        return
      }
      try {
        resolve(JSON.parse(output) as unknown)
      } catch (error) {
        reject(
          new Error(
            `could not decode vidactc output: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      }
    })
    child.stdin.end(source)
  })
}
