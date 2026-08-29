import { readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { vidact } from '@vidact/vite'
import { build } from 'vite'

import {
  crossModuleHookComponents,
  externalReactPackageComponents,
  ownerCertifiedShadcnComponents,
  productionOnlyShadcnComponents,
  unsupportedBaseUiComponents,
} from '../src/shadcn-compatibility.ts'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = join(projectRoot, 'src')
const componentRoot = join(sourceRoot, 'components', 'ui')
const jsonOutput = process.argv.includes('--json')
const outputArgumentIndex = process.argv.indexOf('--output')
const outputPath = outputArgumentIndex === -1 ? undefined : process.argv[outputArgumentIndex + 1]
const expectedStatuses = new Map([
  ...componentNames(ownerCertifiedShadcnComponents).map((name) => [name, 'production-compiled']),
  ...componentNames(productionOnlyShadcnComponents).map((name) => [name, 'production-compiled']),
  ...componentNames(externalReactPackageComponents).map((name) => [name, 'compiler-error']),
  ...componentNames(crossModuleHookComponents).map((name) => [name, 'compiler-error']),
  ...componentNames(unsupportedBaseUiComponents).map((name) => [name, 'compiler-error']),
])

const componentEntries = (await readdir(componentRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)))
  .map((entry) => ({
    name: basename(entry.name, extname(entry.name)),
    path: join(componentRoot, entry.name),
  }))
  .toSorted((left, right) => left.name.localeCompare(right.name))

const results = Array.from({ length: componentEntries.length })
let nextEntry = 0
await Promise.all(
  Array.from({ length: Math.min(4, componentEntries.length) }, () => auditNextComponent()),
)

async function auditNextComponent() {
  const index = nextEntry
  nextEntry += 1
  const entry = componentEntries[index]
  if (entry === undefined) return
  results[index] = await auditComponent(entry)
  await auditNextComponent()
}

async function auditComponent(entry) {
  try {
    const output = await buildComponent(entry.path)
    const reactPath = findReactPath(output)
    return reactPath === undefined
      ? { component: entry.name, status: 'production-compiled' }
      : { component: entry.name, status: 'react-runtime', reason: reactPath }
  } catch (error) {
    return {
      component: entry.name,
      status: 'compiler-error',
      reason: summarizeError(error),
    }
  }
}

const report = `${JSON.stringify(results, null, 2)}\n`
if (outputPath !== undefined) await writeFile(outputPath, report)

const classificationFailures = results.flatMap((result) => {
  const expected = expectedStatuses.get(result.component)
  if (expected === undefined) return [`${result.component}: missing compatibility classification`]
  return result.status === expected
    ? []
    : [`${result.component}: expected ${expected}, observed ${result.status}`]
})
for (const component of expectedStatuses.keys()) {
  if (!results.some((result) => result.component === component)) {
    classificationFailures.push(`${component}: classified component source is missing`)
  }
}

if (jsonOutput) {
  process.stdout.write(report)
} else {
  for (const result of results) {
    console.log(
      result.status === 'production-compiled'
        ? `PASS ${result.component}`
        : `FAIL ${result.component} [${result.status}] ${result.reason}`,
    )
  }
  const compiled = results.filter((result) => result.status === 'production-compiled').length
  const reactRuntime = results.filter((result) => result.status === 'react-runtime').length
  const compilerErrors = results.filter((result) => result.status === 'compiler-error').length
  console.log(
    `\n${compiled}/${results.length} production-compiled React-free modules; ${compilerErrors} compiler errors; ${reactRuntime} retained React runtime paths.`,
  )
}

if (classificationFailures.length > 0) {
  console.error(`Compatibility classification mismatch:\n${classificationFailures.join('\n')}`)
  process.exitCode = 1
}

async function buildComponent(entry) {
  const result = await build({
    root: projectRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      vidact({
        features: ['async', 'concurrent', 'framework', 'css-insertion', 'profiling'],
      }),
    ],
    resolve: { alias: { '@': sourceRoot } },
    build: {
      write: false,
      lib: { entry, formats: ['es'] },
      rolldownOptions: {
        external: (specifier) => specifier.startsWith('@vidact/runtime'),
      },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  return outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n')
}

function findReactPath(source) {
  const forbidden = [
    [
      'React package import',
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\()\s*["']react(?:-dom)?(?:\/[^"']*)?["']/,
    ],
    ['React element tag', /react\.(?:element|transitional\.element)|REACT_ELEMENT_TYPE|\$\$typeof/],
    ['React DOM renderer', /\b(?:createRoot|hydrateRoot|createFiber|reconcileChildFibers)\s*\(/],
    ['React compatibility adapter', /vidact-react-compat-adapter|react-reconciler/],
  ]
  return forbidden.find(([, pattern]) => pattern.test(source))?.[0]
}

function summarizeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(projectRoot, '<docs>').replaceAll(/\s+/g, ' ').trim()
}

function componentNames(record) {
  return Object.keys(record).map((name) =>
    name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
  )
}
