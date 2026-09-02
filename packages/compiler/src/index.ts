import {
  analyze as analyzeNative,
  analyzeSync as analyzeNativeSync,
  compile as compileNative,
  compileSync as compileNativeSync,
  type CompilerOptions as NativeCompilerOptions,
} from '../dist/binding.js'

export const VIDACT_ANALYSIS_PROTOCOL = 'vidact-analysis-v1' as const
export const VIDACT_COMPILE_PROTOCOL = 'vidact-compile-v2' as const
export const VIDACT_RUNTIME_PROTOCOL = 'vidact-runtime-v2' as const

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
  | 'dependency-source'

export interface VidactCompilerOptions {
  readonly filename: string
  readonly target?: VidactTarget
  readonly features?: readonly VidactFeature[]
}

export interface VidactAnalysisOptions {
  readonly filename: string
}

export interface VidactCompilerConfiguration {
  readonly target: VidactTarget
  readonly features: readonly VidactFeature[]
}

export interface VidactSourceSpan {
  readonly start: number
  readonly end: number
}

export interface VidactReactiveFlowValue {
  readonly id: number
  readonly declarationId: number
  readonly source: number | null
  readonly name: string
  readonly span: VidactSourceSpan | null
}

export interface VidactReactiveFlowBlock {
  readonly id: number
  readonly predecessors: readonly number[]
  readonly phis: readonly {
    readonly target: VidactReactiveFlowValue
    readonly operands: readonly {
      readonly predecessor: number
      readonly value: VidactReactiveFlowValue
    }[]
  }[]
}

export interface VidactComponentAnalysis {
  readonly name: string
  readonly span: VidactSourceSpan | null
  readonly reactiveFlow: readonly VidactReactiveFlowBlock[]
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

export interface VidactAnalysis {
  readonly protocol: typeof VIDACT_ANALYSIS_PROTOCOL
  readonly components: readonly VidactComponentAnalysis[]
}

export interface VidactCompilation {
  readonly protocol: typeof VIDACT_COMPILE_PROTOCOL
  readonly runtimeProtocol: typeof VIDACT_RUNTIME_PROTOCOL
  readonly configuration: VidactCompilerConfiguration
  readonly code: string
  readonly sourceMap: Record<string, unknown>
  readonly analysis: VidactAnalysis
}

export class VidactCompilerError extends Error {
  override readonly name = 'VidactCompilerError'
}

export function compileSync(source: string, options: VidactCompilerOptions): VidactCompilation {
  try {
    return decodeCompilation(compileNativeSync(source, nativeOptions(options)))
  } catch (error) {
    throw compilerError(error)
  }
}

export async function compile(
  source: string,
  options: VidactCompilerOptions,
): Promise<VidactCompilation> {
  try {
    return decodeCompilation(await compileNative(source, nativeOptions(options)))
  } catch (error) {
    throw compilerError(error)
  }
}

export function analyzeSync(source: string, options: VidactAnalysisOptions): VidactAnalysis {
  try {
    return decodeAnalysis(analyzeNativeSync(source, nativeOptions(options)))
  } catch (error) {
    throw compilerError(error)
  }
}

export async function analyze(
  source: string,
  options: VidactAnalysisOptions,
): Promise<VidactAnalysis> {
  try {
    return decodeAnalysis(await analyzeNative(source, nativeOptions(options)))
  } catch (error) {
    throw compilerError(error)
  }
}

function nativeOptions(options: VidactCompilerOptions): NativeCompilerOptions {
  return {
    filename: options.filename,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.features === undefined ? {} : { features: [...options.features] }),
  }
}

function decodeCompilation(value: unknown): VidactCompilation {
  if (
    !isRecord(value) ||
    value.protocol !== VIDACT_COMPILE_PROTOCOL ||
    value.runtimeProtocol !== VIDACT_RUNTIME_PROTOCOL ||
    typeof value.code !== 'string' ||
    !isRecord(value.sourceMap) ||
    !isAnalysis(value.analysis) ||
    !isConfiguration(value.configuration)
  ) {
    throw new VidactCompilerError('native compiler returned an unsupported compilation protocol')
  }
  return value as unknown as VidactCompilation
}

function decodeAnalysis(value: unknown): VidactAnalysis {
  if (!isAnalysis(value)) {
    throw new VidactCompilerError('native compiler returned an unsupported analysis protocol')
  }
  return value as unknown as VidactAnalysis
}

function isAnalysis(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.protocol === VIDACT_ANALYSIS_PROTOCOL &&
    Array.isArray(value.components)
  )
}

function isConfiguration(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.target === 'client' || value.target === 'hydrate' || value.target === 'server') &&
    Array.isArray(value.features)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function compilerError(error: unknown): VidactCompilerError {
  if (error instanceof VidactCompilerError) return error
  return new VidactCompilerError(error instanceof Error ? error.message : String(error), {
    cause: error,
  })
}
