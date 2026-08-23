import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { vidact } from '@vidact/vite'
import { build } from 'vite'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../..')
const fixtures = [
  { name: 'counter', entry: path.join(directory, 'fixtures/counter.tsx'), gzipBudget: 8_104 },
  {
    name: 'async-unused',
    entry: path.join(directory, 'fixtures/counter.tsx'),
    features: ['async'],
    gzipBudget: 8_104,
  },
  {
    name: 'concurrent-unused',
    entry: path.join(directory, 'fixtures/counter.tsx'),
    features: ['concurrent'],
    gzipBudget: 8_200,
  },
  {
    name: 'concurrent',
    entry: path.join(directory, 'fixtures/concurrent.tsx'),
    features: ['concurrent'],
    gzipBudget: 9_765,
  },
  {
    name: 'actions-unused',
    entry: path.join(directory, 'fixtures/counter.tsx'),
    features: ['actions'],
    gzipBudget: 8_104,
  },
  {
    name: 'actions',
    entry: path.join(directory, 'fixtures/actions.tsx'),
    features: ['actions'],
    gzipBudget: 11_485,
  },
  {
    name: 'retained-ui-unused',
    entry: path.join(directory, 'fixtures/counter.tsx'),
    features: ['retained-ui'],
    gzipBudget: 8_104,
  },
  {
    name: 'retained-ui',
    entry: path.join(directory, 'fixtures/retained-ui.tsx'),
    features: ['retained-ui'],
    gzipBudget: 11_500,
  },
  {
    name: 'profiling-unused',
    entry: path.join(directory, 'fixtures/counter.tsx'),
    features: ['profiling'],
    gzipBudget: 8_104,
  },
  {
    name: 'profiling',
    entry: path.join(directory, 'fixtures/profiling.tsx'),
    features: ['profiling'],
    gzipBudget: 11_500,
  },
  {
    name: 'framework-unused',
    entry: path.join(directory, 'fixtures/counter.tsx'),
    features: ['framework'],
    gzipBudget: 8_104,
  },
  {
    name: 'framework',
    entry: path.join(directory, 'fixtures/framework.tsx'),
    features: ['framework'],
    gzipBudget: 11_500,
  },
  {
    name: 'control-flow',
    entry: path.join(directory, 'fixtures/control-flow.tsx'),
    gzipBudget: 8_526,
  },
  {
    name: 'keyed-list',
    entry: path.join(directory, 'fixtures/keyed-list.tsx'),
    gzipBudget: 9_318,
  },
  {
    name: 'todomvc',
    entry: path.join(repository, 'examples/todomvc/src/TodoApp.tsx'),
    gzipBudget: 10_957,
  },
  { name: 'effect', entry: path.join(directory, 'fixtures/effect.tsx'), gzipBudget: 8_409 },
]

const measurements = await Promise.all(fixtures.map(measureFixture))

process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`)

const regressions = measurements.flatMap((measurement, index) => {
  const fixture = fixtures[index]
  return measurement.gzip > fixture.gzipBudget
    ? [`${fixture.name}: ${measurement.gzip} B > ${fixture.gzipBudget} B`]
    : []
})
const counter = measurements.find((measurement) => measurement.fixture === 'counter')
const asyncUnused = measurements.find((measurement) => measurement.fixture === 'async-unused')
const concurrentUnused = measurements.find(
  (measurement) => measurement.fixture === 'concurrent-unused',
)
const actionsUnused = measurements.find((measurement) => measurement.fixture === 'actions-unused')
const retainedUiUnused = measurements.find(
  (measurement) => measurement.fixture === 'retained-ui-unused',
)
const profilingUnused = measurements.find(
  (measurement) => measurement.fixture === 'profiling-unused',
)
const frameworkUnused = measurements.find(
  (measurement) => measurement.fixture === 'framework-unused',
)
if (
  counter === undefined ||
  asyncUnused === undefined ||
  concurrentUnused === undefined ||
  actionsUnused === undefined ||
  retainedUiUnused === undefined ||
  profilingUnused === undefined ||
  frameworkUnused === undefined ||
  counter.minified !== asyncUnused.minified ||
  counter.gzip !== asyncUnused.gzip ||
  counter.minified !== concurrentUnused.minified ||
  counter.gzip !== concurrentUnused.gzip ||
  counter.minified !== actionsUnused.minified ||
  counter.gzip !== actionsUnused.gzip ||
  counter.minified !== retainedUiUnused.minified ||
  counter.gzip !== retainedUiUnused.gzip ||
  counter.minified !== profilingUnused.minified ||
  counter.gzip !== profilingUnused.gzip ||
  counter.minified !== frameworkUnused.minified ||
  counter.gzip !== frameworkUnused.gzip
) {
  regressions.push(
    'enabling an unused async, concurrent, Actions, retained UI, profiling, or framework family changed the counter artifact',
  )
}
if (
  frameworkUnused?.modules.some((module) => module.id.endsWith('packages/runtime/dist/metadata.js'))
) {
  regressions.push('enabling an unused framework family retained the metadata runtime')
}
if (regressions.length > 0) {
  throw new Error(`gzip budget exceeded:\n${regressions.join('\n')}`)
}

async function measureFixture(fixture) {
  const output = await build({
    root: directory,
    configFile: false,
    logLevel: 'silent',
    plugins: [vidact({ manifestPath: '../../Cargo.toml', features: fixture.features ?? [] })],
    build: {
      write: false,
      minify: 'oxc',
      lib: { entry: fixture.entry, formats: ['es'] },
      rollupOptions: { output: { comments: false } },
    },
  })
  const outputs = Array.isArray(output) ? output.flatMap((item) => item.output) : output.output
  const chunks = outputs.filter((item) => item.type === 'chunk')
  if (chunks.length !== 1) {
    throw new Error(`${fixture.name} emitted ${chunks.length} chunks; update the size accounting`)
  }
  const code = chunks[0].code
  if (code.includes('Vidact compiled scope did not stabilize')) {
    throw new Error(`${fixture.name} retained development diagnostics`)
  }
  if (code.includes('vidact.updater:') || code.includes('useDebugValue must run')) {
    throw new Error(`${fixture.name} retained development profiling instrumentation`)
  }
  const modules = chunks
    .flatMap((chunk) =>
      Object.entries(chunk.modules).map(([id, details]) => ({
        id: path.relative(repository, id),
        rendered: details.renderedLength,
      })),
    )
    .filter((module) => module.rendered > 0)
    .toSorted((left, right) => right.rendered - left.rendered)
  if (modules.some((module) => module.id.endsWith('/hydration.js'))) {
    throw new Error(`${fixture.name} included the hydrate-only DOM scanner in a client bundle`)
  }

  return {
    fixture: fixture.name,
    minified: Buffer.byteLength(code),
    gzip: gzipSync(code, { level: 9 }).byteLength,
    modules,
  }
}
