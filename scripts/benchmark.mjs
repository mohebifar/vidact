/* oxlint-disable eslint/no-await-in-loop -- Benchmark samples must execute serially for meaningful distributions and cache retention. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCompiledScope, source as sourceMask } from '../packages/runtime/dist/index.js'
import { vidact } from '../packages/vite-plugin/dist/index.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '..')
const fixtures = [
  'tests/runtime-size/fixtures/counter.tsx',
  'tests/runtime-size/fixtures/control-flow.tsx',
  'tests/runtime-size/fixtures/keyed-list.tsx',
]
const plugin = vidact()

if (typeof plugin.transform !== 'function')
  throw new TypeError('Vidact benchmark requires a transform hook')
const context = { environment: { name: 'benchmark-client' } }
const samples = []
const updaterCounts = [64, 256, 1_024]
const compilationSampleCount = 20
const retentionWarmupRevisions = 10
const retentionMeasuredRevisions = 100

for (const relativePath of fixtures) {
  const filename = path.join(repository, relativePath)
  const source = await readFile(filename, 'utf8')
  const cold = await measure(() => compile(plugin, source, filename))
  const unchangedCacheHits = []
  for (let iteration = 0; iteration < compilationSampleCount; iteration += 1) {
    unchangedCacheHits.push(await measure(() => compile(plugin, source, filename)))
  }
  const changedSources = []
  let latestRevision = source
  for (let iteration = 1; iteration <= compilationSampleCount; iteration += 1) {
    latestRevision = revisionSource(source, iteration)
    changedSources.push(await measure(() => compile(plugin, latestRevision, filename)))
  }
  const postRevisionCacheHit = await measure(() => compile(plugin, latestRevision, filename))
  samples.push({
    fixture: relativePath,
    sourceBytes: Buffer.byteLength(source),
    coldMilliseconds: cold,
    unchangedCacheHitMilliseconds: unchangedCacheHits,
    unchangedCacheHitMedianMilliseconds: percentile(unchangedCacheHits, 0.5),
    unchangedCacheHitP95Milliseconds: percentile(unchangedCacheHits, 0.95),
    changedSourceMilliseconds: changedSources,
    changedSourceMedianMilliseconds: percentile(changedSources, 0.5),
    changedSourceP95Milliseconds: percentile(changedSources, 0.95),
    postRevisionCacheHitMilliseconds: postRevisionCacheHit,
  })
}

if (globalThis.gc === undefined) {
  throw new Error('Vidact benchmark requires node --expose-gc for retention measurements')
}
const retentionPlugin = vidact()
if (typeof retentionPlugin.transform !== 'function') {
  throw new TypeError('Vidact retention benchmark requires a transform hook')
}
const retentionFixtures = await Promise.all(
  fixtures.map(async (relativePath) => ({
    filename: path.join(repository, relativePath),
    source: await readFile(path.join(repository, relativePath), 'utf8'),
  })),
)
for (let revision = 0; revision < retentionWarmupRevisions; revision += 1) {
  for (const fixture of retentionFixtures) {
    await compile(retentionPlugin, revisionSource(fixture.source, revision), fixture.filename)
  }
}
globalThis.gc()
const changedRevisionHeapBefore = process.memoryUsage().heapUsed
for (let revision = 0; revision < retentionMeasuredRevisions; revision += 1) {
  for (const fixture of retentionFixtures) {
    await compile(
      retentionPlugin,
      revisionSource(fixture.source, retentionWarmupRevisions + revision),
      fixture.filename,
    )
  }
}
globalThis.gc()
const changedRevisionHeapGrowthBytes = Math.max(
  0,
  process.memoryUsage().heapUsed - changedRevisionHeapBefore,
)

const updaterOrderSamples = updaterCounts.map((updaterCount) => {
  const measurements = []
  for (let iteration = 0; iteration < 5; iteration += 1) {
    measurements.push(measureUpdaterOrder(updaterCount))
  }
  return {
    updaterCount,
    milliseconds: measurements,
    medianMilliseconds: percentile(measurements, 0.5),
    p95Milliseconds: percentile(measurements, 0.95),
  }
})
const updaterChurnMilliseconds = measureUpdaterChurn(256, 100)

const report = {
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  budgets: {
    coldMilliseconds: 10_000,
    unchangedCacheHitP95Milliseconds: 50,
    changedSourceP95Milliseconds: 250,
    postRevisionCacheHitMilliseconds: 50,
    changedRevisionHeapGrowthBytes: 32 * 1024 * 1024,
    updaterOrderP95Milliseconds: 20,
    updaterChurnMilliseconds: 50,
  },
  methodology: {
    compilation: {
      coldSamplesPerFixture: 1,
      unchangedCacheHitsPerFixture: compilationSampleCount,
      changedRevisionsPerFixture: compilationSampleCount,
      revisionMethod: 'same filename with a unique trailing block comment',
      percentile: 'nearest-rank p95',
    },
    retention: {
      warmupRevisionsPerFixture: retentionWarmupRevisions,
      measuredRevisionsPerFixture: retentionMeasuredRevisions,
      measurement: 'positive JavaScript heap delta after explicit GC',
    },
    updaterOrder: {
      samplesPerCount: 5,
      counts: updaterCounts,
      graph: 'reverse-registered sparse chain',
    },
    updaterChurn: {
      updaterCount: 256,
      iterations: 100,
      operation: 'remove, replace, and flush one updater per iteration',
    },
    thresholdRationale:
      'Smoke ceilings include substantial host variance while separating cache hits from compiler work; they do not compare Vidact with another framework.',
  },
  changedRevisionHeapGrowthBytes,
  samples,
  updaterOrderSamples,
  updaterChurn: {
    updaterCount: 256,
    iterations: 100,
    milliseconds: updaterChurnMilliseconds,
  },
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

const failures = []
for (const sample of samples) {
  if (sample.coldMilliseconds > report.budgets.coldMilliseconds) {
    failures.push(`${sample.fixture} cold transform exceeded ${report.budgets.coldMilliseconds} ms`)
  }
  if (sample.unchangedCacheHitP95Milliseconds > report.budgets.unchangedCacheHitP95Milliseconds) {
    failures.push(
      `${sample.fixture} unchanged-cache p95 exceeded ${report.budgets.unchangedCacheHitP95Milliseconds} ms`,
    )
  }
  if (sample.changedSourceP95Milliseconds > report.budgets.changedSourceP95Milliseconds) {
    failures.push(
      `${sample.fixture} changed-source p95 exceeded ${report.budgets.changedSourceP95Milliseconds} ms`,
    )
  }
  if (sample.postRevisionCacheHitMilliseconds > report.budgets.postRevisionCacheHitMilliseconds) {
    failures.push(
      `${sample.fixture} post-revision cache hit exceeded ${report.budgets.postRevisionCacheHitMilliseconds} ms`,
    )
  }
}
if (changedRevisionHeapGrowthBytes > report.budgets.changedRevisionHeapGrowthBytes) {
  failures.push(`changed-source transforms retained ${changedRevisionHeapGrowthBytes} bytes`)
}
for (const sample of updaterOrderSamples) {
  if (sample.p95Milliseconds > report.budgets.updaterOrderP95Milliseconds) {
    failures.push(
      `${sample.updaterCount} updater ordering exceeded ${report.budgets.updaterOrderP95Milliseconds} ms`,
    )
  }
}
if (updaterChurnMilliseconds > report.budgets.updaterChurnMilliseconds) {
  failures.push(`updater churn exceeded ${report.budgets.updaterChurnMilliseconds} ms`)
}
if (failures.length > 0) throw new Error(`benchmark budget exceeded:\n${failures.join('\n')}`)

async function measure(operation) {
  const started = performance.now()
  await operation()
  return performance.now() - started
}

async function compile(compiler, source, filename) {
  const result = await compiler.transform.call(context, source, filename)
  if (result === null || typeof result !== 'object' || !('code' in result)) {
    throw new Error(`benchmark fixture did not compile: ${path.relative(repository, filename)}`)
  }
  if (result.code.includes('react/jsx-runtime')) {
    throw new Error(`benchmark fixture retained React JSX: ${path.relative(repository, filename)}`)
  }
  return result
}

function revisionSource(source, revision) {
  return `${source}\n/* vidact-benchmark-revision:${revision} */\n`
}

function percentile(values, rank) {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * rank) - 1] ?? 0
}

function measureUpdaterOrder(updaterCount) {
  const scope = createCompiledScope()
  const sources = Array.from({ length: updaterCount + 1 }, (_, index) => sourceMask(index))
  let executions = 0
  for (let index = updaterCount - 1; index >= 0; index -= 1) {
    scope[0](
      sources[index],
      () => {
        executions += 1
      },
      sources[index + 1],
    )
  }

  const started = performance.now()
  scope[1](sources[0])
  const elapsed = performance.now() - started
  scope[3]()
  if (executions !== updaterCount) {
    throw new Error(`expected ${updaterCount} updater executions, received ${executions}`)
  }
  return elapsed
}

function measureUpdaterChurn(updaterCount, iterations) {
  const scope = createCompiledScope()
  const sources = Array.from({ length: updaterCount + 1 }, (_, index) => sourceMask(index))
  const removers = []
  let executions = 0
  const register = (index) =>
    scope[0](
      sources[index],
      () => {
        executions += 1
      },
      sources[index + 1],
    )
  for (let index = 0; index < updaterCount; index += 1) removers.push(register(index))
  scope[1](sources[0])

  const started = performance.now()
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const index = iteration % updaterCount
    removers[index]()
    removers[index] = register(index)
    scope[1](sources[0])
  }
  const elapsed = performance.now() - started
  scope[3]()
  const expectedExecutions = updaterCount * (iterations + 1)
  if (executions !== expectedExecutions) {
    throw new Error(`expected ${expectedExecutions} churn executions, received ${executions}`)
  }
  return elapsed
}
