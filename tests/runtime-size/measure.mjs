import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { vidact } from '@vidact/vite'
import { build } from 'vite'

const directory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(directory, '../..')
const fixtures = [
  { name: 'counter', entry: path.join(directory, 'fixtures/counter.tsx'), gzipBudget: 7_579 },
  {
    name: 'control-flow',
    entry: path.join(directory, 'fixtures/control-flow.tsx'),
    gzipBudget: 7_905,
  },
  {
    name: 'keyed-list',
    entry: path.join(directory, 'fixtures/keyed-list.tsx'),
    gzipBudget: 8_708,
  },
  {
    name: 'todomvc',
    entry: path.join(repository, 'examples/todomvc/src/TodoApp.tsx'),
    gzipBudget: 10_302,
  },
]

const measurements = await Promise.all(fixtures.map(measureFixture))

process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`)

const regressions = measurements.flatMap((measurement, index) => {
  const fixture = fixtures[index]
  return measurement.gzip > fixture.gzipBudget
    ? [`${fixture.name}: ${measurement.gzip} B > ${fixture.gzipBudget} B`]
    : []
})
if (regressions.length > 0) {
  throw new Error(`gzip budget exceeded:\n${regressions.join('\n')}`)
}

async function measureFixture(fixture) {
  const output = await build({
    root: directory,
    configFile: false,
    logLevel: 'silent',
    plugins: [vidact({ manifestPath: '../../Cargo.toml' })],
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
  const modules = chunks
    .flatMap((chunk) =>
      Object.entries(chunk.modules).map(([id, details]) => ({
        id: path.relative(repository, id),
        rendered: details.renderedLength,
      })),
    )
    .filter((module) => module.rendered > 0)
    .toSorted((left, right) => right.rendered - left.rendered)

  return {
    fixture: fixture.name,
    minified: Buffer.byteLength(code),
    gzip: gzipSync(code, { level: 9 }).byteLength,
    modules,
  }
}
