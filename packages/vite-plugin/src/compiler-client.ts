import {
  analyze,
  compile,
  VIDACT_COMPILE_PROTOCOL,
  VIDACT_RUNTIME_PROTOCOL as COMPILER_RUNTIME_PROTOCOL,
  type VidactAnalysis,
  type VidactCompilation,
  type VidactCompilerConfiguration,
} from '@vidact/compiler'
import { VIDACT_RUNTIME_PROTOCOL } from '@vidact/runtime/protocol'

if (COMPILER_RUNTIME_PROTOCOL !== VIDACT_RUNTIME_PROTOCOL) {
  throw new Error('installed Vidact compiler and runtime protocols do not match')
}

export { VIDACT_COMPILE_PROTOCOL, VIDACT_RUNTIME_PROTOCOL }

export function analyzeWithCompiler(source: string, filename: string): Promise<VidactAnalysis> {
  return analyze(source, { filename })
}

export function compileWithCompiler(
  source: string,
  filename: string,
  configuration: VidactCompilerConfiguration = { target: 'client', features: [] },
): Promise<VidactCompilation> {
  return compile(source, { filename, ...normalizeConfiguration(configuration) })
}

export function normalizeConfiguration(
  configuration: VidactCompilerConfiguration,
): VidactCompilerConfiguration {
  return {
    target: configuration.target,
    features: [...new Set(configuration.features)].toSorted(),
  }
}

export type {
  VidactAnalysis,
  VidactCompilation,
  VidactComponentAnalysis,
  VidactCompilerConfiguration,
  VidactFeature,
  VidactTarget,
} from '@vidact/compiler'
