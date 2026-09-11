// oxlint-disable no-await-in-loop -- Server polling and local-package resolution are intentionally sequential.
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const benchmarkRoot = resolve(
  process.env.VIDACT_JS_BENCH_ROOT ?? '/Users/mohebifar/dev/other/js-framework-benchmark',
)
const frameworkRoot = join(benchmarkRoot, 'frameworks/keyed/vidact')
const webdriverRoot = join(benchmarkRoot, 'webdriver-ts')
const resultsRoot = join(webdriverRoot, 'results')
const runtimeRoot = resolve(process.env.VIDACT_RUNTIME_ROOT ?? join(repoRoot, 'packages/runtime'))
const compilerRoot = join(repoRoot, 'packages/compiler')
const viteRoot = join(repoRoot, 'packages/vite-plugin')
const reactTypesRoot = join(repoRoot, 'packages/react-types')
const smoke = process.argv.includes('--smoke')
const benchmarkPort = Number(process.env.VIDACT_JS_BENCH_PORT ?? 8080)
const benchmarkEnvironment = { HOST: '[::1]', BENCHMARK_PORT: String(benchmarkPort) }

const cpuBenchmarks = smoke
  ? ['01_run1k', '05_swap1k', '09_clear1k_x8']
  : [
      '01_run1k',
      '02_replace1k',
      '03_update10th1k_x16',
      '04_select1k',
      '05_swap1k',
      '06_remove-one-1k',
      '07_create10k',
      '08_create1k-after1k_x2',
      '09_clear1k_x8',
    ]
const auxiliaryRequests = smoke
  ? []
  : ['21_ready-memory', '22_run-memory', '25_run-clear-memory', '40_sizes']
const auxiliaryResults = smoke
  ? []
  : [
      '21_ready-memory',
      '22_run-memory',
      '25_run-clear-memory',
      '41_size-uncompressed',
      '42_size-compressed',
      '43_first-paint',
    ]

const commandTail = []

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', rejectRun)
    child.on('close', (code) => {
      commandTail.push(`$ ${command} ${args.join(' ')}\n${output.slice(-4_000)}`)
      if (code === 0) {
        resolveRun(output)
      } else {
        rejectRun(new Error(`${command} exited with code ${code}\n${output.slice(-4_000)}`))
      }
    })
  })
}

async function waitForServer(server) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`benchmark server exited with code ${server.exitCode}`)
    }
    try {
      const response = await fetch(
        `http://[::1]:${benchmarkPort}/frameworks/keyed/vidact/index.html`,
      )
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('benchmark server did not become ready on port 8080')
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => server.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ])
  if (server.exitCode === null) server.kill('SIGKILL')
}

async function newestResult(benchmark, startedAt) {
  const suffix = `-keyed_${benchmark}.json`
  const names = (await readdir(resultsRoot)).filter(
    (name) => name.startsWith('vidact-v') && name.endsWith(suffix),
  )
  const candidates = await Promise.all(
    names.map(async (name) => {
      const path = join(resultsRoot, name)
      const [result, metadata] = await Promise.all([
        readFile(path, 'utf8').then(JSON.parse),
        stat(path),
      ])
      return { name, result, metadata }
    }),
  )
  const fresh = candidates.filter(
    ({ result, metadata }) => result.benchmark === benchmark && metadata.mtimeMs >= startedAt,
  )
  if (fresh.length === 0) {
    throw new Error(`missing result for ${benchmark} after ${startedAt}`)
  }
  // Local runtime versions can change the result filename. The runner rewrites the
  // matching result, so select the local package version when it is available.
  const runtimePackage = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8'))
  const expected = `vidact-v${runtimePackage.version}-keyed`
  return (fresh.find(({ result }) => result.framework === expected) ?? fresh.at(-1)).result
}

function mean(result, category = 'DEFAULT') {
  return result.values[category].mean
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length)
}

async function main() {
  let server
  let benchmarkPassed = 0
  let keyedPassed = 0
  let runtimeTestsPassed = 0
  try {
    await run('pnpm', ['--filter', '@vidact/compiler', 'build'])
    await run('pnpm', ['--filter', '@vidact/runtime', 'build'])
    await run('pnpm', ['--filter', '@vidact/vite', 'build'])
    await run(
      'npm',
      [
        'install',
        '--no-save',
        '--package-lock=false',
        runtimeRoot,
        compilerRoot,
        viteRoot,
        reactTypesRoot,
      ],
      {
        cwd: frameworkRoot,
      },
    )
    for (const [packageName, packageRoot] of [
      ['@vidact/runtime', runtimeRoot],
      ['@vidact/compiler', compilerRoot],
      ['@vidact/vite', viteRoot],
    ]) {
      const resolved = (
        await run(
          'node',
          ['--input-type=module', '-e', `console.log(import.meta.resolve('${packageName}'))`],
          { cwd: frameworkRoot },
        )
      ).trim()
      const installedRuntimeCopy =
        packageName === '@vidact/runtime' &&
        process.env.VIDACT_RUNTIME_ROOT !== undefined &&
        resolved.startsWith(`file://${frameworkRoot}/node_modules/@vidact/runtime/`)
      if (!resolved.startsWith(`file://${packageRoot}/`) && !installedRuntimeCopy) {
        throw new Error(`benchmark resolved a non-local ${packageName}: ${resolved}`)
      }
    }
    await run('npm', ['run', 'build-prod'], { cwd: frameworkRoot })
    await run('pnpm', [
      '--filter',
      '@vidact/runtime',
      'exec',
      'vitest',
      'run',
      'test/arrays/keyed-arrays.browser.test.ts',
      'test/reactivity/compiled-dom.browser.test.ts',
      '--browser.name=chromium',
    ])
    runtimeTestsPassed = 1

    server = spawn(
      join(benchmarkRoot, 'server/node_modules/.bin/tsx'),
      [
        '-e',
        "import { buildServer } from './app.ts'; void (async () => { const server = buildServer(); await server.listen({ port: Number(process.env.BENCHMARK_PORT), host: '::1' }); console.log('ready'); })();",
      ],
      {
        cwd: join(benchmarkRoot, 'server'),
        env: { ...process.env, ...benchmarkEnvironment },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let serverOutput = ''
    server.stdout.on('data', (chunk) => {
      serverOutput += chunk
    })
    server.stderr.on('data', (chunk) => {
      serverOutput += chunk
    })
    await waitForServer(server)

    const startedAt = Date.now()
    await run(
      'node',
      [
        'dist/benchmarkRunner.js',
        '--runner',
        'playwright',
        '--headless',
        'true',
        '--count',
        smoke ? '1' : '5',
        '--framework',
        'keyed/vidact',
        '--benchmark',
        ...cpuBenchmarks,
      ],
      { cwd: webdriverRoot, env: benchmarkEnvironment },
    )
    if (auxiliaryRequests.length > 0) {
      await run(
        'node',
        [
          'dist/benchmarkRunner.js',
          '--runner',
          'playwright',
          '--headless',
          'true',
          '--count',
          '1',
          '--framework',
          'keyed/vidact',
          '--benchmark',
          ...auxiliaryRequests,
        ],
        { cwd: webdriverRoot, env: benchmarkEnvironment },
      )
    }
    benchmarkPassed = 1

    await run('node', ['dist/isKeyed.js', '--headless', 'true', '--framework', 'keyed/vidact'], {
      cwd: webdriverRoot,
      env: benchmarkEnvironment,
    })
    keyedPassed = 1

    const cpuResults = Object.fromEntries(
      await Promise.all(
        cpuBenchmarks.map(async (benchmark) => [
          benchmark,
          await newestResult(benchmark, startedAt),
        ]),
      ),
    )
    const cpuMeans = cpuBenchmarks.map((benchmark) => mean(cpuResults[benchmark], 'total'))
    const output = {
      cpu_geomean_ms: geometricMean(cpuMeans),
      benchmark_passed: benchmarkPassed,
      keyed_passed: keyedPassed,
      runtime_tests_passed: runtimeTestsPassed,
      create_1k_ms: mean(cpuResults['01_run1k'], 'total'),
      swap_ms: mean(cpuResults['05_swap1k'], 'total'),
      clear_ms: mean(cpuResults['09_clear1k_x8'], 'total'),
      create_1k_script_ms: mean(cpuResults['01_run1k'], 'script'),
      create_1k_paint_ms: mean(cpuResults['01_run1k'], 'paint'),
      swap_script_ms: mean(cpuResults['05_swap1k'], 'script'),
      swap_paint_ms: mean(cpuResults['05_swap1k'], 'paint'),
    }
    if (!smoke) {
      const auxiliaryResultValues = Object.fromEntries(
        await Promise.all(
          auxiliaryResults.map(async (benchmark) => [
            benchmark,
            await newestResult(benchmark, startedAt),
          ]),
        ),
      )
      Object.assign(output, {
        replace_1k_ms: mean(cpuResults['02_replace1k'], 'total'),
        update_10th_ms: mean(cpuResults['03_update10th1k_x16'], 'total'),
        select_ms: mean(cpuResults['04_select1k'], 'total'),
        remove_ms: mean(cpuResults['06_remove-one-1k'], 'total'),
        create_10k_ms: mean(cpuResults['07_create10k'], 'total'),
        append_1k_ms: mean(cpuResults['08_create1k-after1k_x2'], 'total'),
        ready_memory_mb: mean(auxiliaryResultValues['21_ready-memory']),
        run_memory_mb: mean(auxiliaryResultValues['22_run-memory']),
        run_clear_memory_mb: mean(auxiliaryResultValues['25_run-clear-memory']),
        uncompressed_kb: mean(auxiliaryResultValues['41_size-uncompressed']),
        compressed_kb: mean(auxiliaryResultValues['42_size-compressed']),
        first_paint_ms: mean(auxiliaryResultValues['43_first-paint']),
      })
    }
    console.log(JSON.stringify(output))
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error)
    if (commandTail.length > 0) console.error(commandTail.at(-1))
    process.exitCode = 1
  } finally {
    if (server) await stopServer(server)
  }
}

await main()
