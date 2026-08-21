import { spawn } from 'node:child_process'
import path from 'node:path'

export interface VidactAnalysis {
  readonly protocol: 'vidact-analysis-v1'
  readonly components: readonly VidactComponentAnalysis[]
}

export interface VidactComponentAnalysis {
  readonly name: string
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
  readonly protocol: 'vidact-compile-v1'
  readonly code: string
  readonly analysis: VidactAnalysis
}

export function analyzeWithCompiler(
  source: string,
  filename: string,
  manifestPath: string,
): Promise<VidactAnalysis> {
  return runCompiler('analyze', source, filename, manifestPath).then((result) => {
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
): Promise<VidactCompilation> {
  return runCompiler('compile', source, filename, manifestPath).then((result) => {
    const compilation = result as Partial<VidactCompilation>
    if (
      compilation.protocol !== 'vidact-compile-v1'
      || typeof compilation.code !== 'string'
      || compilation.analysis?.protocol !== 'vidact-analysis-v1'
    ) {
      throw new Error('vidactc returned an unsupported compilation protocol')
    }
    return compilation as VidactCompilation
  })
}

function runCompiler(
  command: 'analyze' | 'compile',
  source: string,
  filename: string,
  manifestPath: string,
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
