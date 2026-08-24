/* oxlint-disable eslint/no-await-in-loop -- Benchmark samples must execute serially for meaningful distributions and cache retention. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  },
  heapGrowthBytes,
  samples,
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
