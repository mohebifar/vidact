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

for (const relativePath of fixtures) {
  const filename = path.join(repository, relativePath)
  const source = await readFile(filename, 'utf8')
  const cold = await measure(() => plugin.transform.call(context, source, filename))
  const incremental = []
  for (let iteration = 0; iteration < 20; iteration += 1) {
    incremental.push(await measure(() => plugin.transform.call(context, source, filename)))
  }
  samples.push({
    fixture: relativePath,
    coldMilliseconds: cold,
    incrementalMilliseconds: incremental,
    incrementalMedianMilliseconds: percentile(incremental, 0.5),
    incrementalP95Milliseconds: percentile(incremental, 0.95),
  })
}

globalThis.gc?.()
const heapBefore = process.memoryUsage().heapUsed
for (let iteration = 0; iteration < 50; iteration += 1) {
  for (const relativePath of fixtures) {
    const filename = path.join(repository, relativePath)
    const source = await readFile(filename, 'utf8')
    await plugin.transform.call(context, source, filename)
  }
}
globalThis.gc?.()
const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore)

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
    incrementalP95Milliseconds: 500,
    retainedHeapBytes: 32 * 1024 * 1024,
    updaterOrderP95Milliseconds: 20,
    updaterChurnMilliseconds: 50,
  },
  heapGrowthBytes,
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
  if (sample.incrementalP95Milliseconds > report.budgets.incrementalP95Milliseconds) {
    failures.push(
      `${sample.fixture} incremental p95 exceeded ${report.budgets.incrementalP95Milliseconds} ms`,
    )
  }
}
if (heapGrowthBytes > report.budgets.retainedHeapBytes) {
  failures.push(`incremental transforms retained ${heapGrowthBytes} bytes`)
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
  const register = (index) => scope[0](sources[index], () => {}, sources[index + 1])
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
  return elapsed
}
