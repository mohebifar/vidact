import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const distributionRoot = join(projectRoot, 'dist')

const forbidden = [
  {
    label: 'React package import',
    pattern: /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["']react(?:-dom)?(?:\/[^"']*)?["']/,
  },
  {
    label: 'React element tag',
    pattern: /react\.(?:element|transitional\.element)|REACT_ELEMENT_TYPE|\$\$typeof/,
  },
  {
    label: 'React DOM renderer',
    pattern: /\b(?:createRoot|hydrateRoot|createFiber|reconcileChildFibers)\s*\(/,
  },
  {
    label: 'React compatibility adapter',
    pattern: /vidact-react-compat-adapter|react-reconciler/,
  },
]

for (const seed of [
  'import React from "react"',
  'const element = { $$typeof: Symbol.for("react.element") }',
  'hydrateRoot(host, tree)',
  '/* vidact-react-compat-adapter */',
]) {
  if (findForbidden(seed).length === 0) {
    throw new Error(`production bundle verifier did not reject its seeded artifact: ${seed}`)
  }
}

const files = await javascriptFiles(distributionRoot)
if (files.length === 0) throw new Error('shop production bundles are missing; run the build first')

let combined = ''
const failures = []
for (const file of files) {
  const source = stripRollupSourceMarkers(await readFile(file, 'utf8'))
  combined += source
  for (const label of findForbidden(source))
    failures.push(`${relative(projectRoot, file)}: ${label}`)
}

if (failures.length > 0) {
  throw new Error(`shop production bundle contains forbidden React paths:\n${failures.join('\n')}`)
}
if (!combined.includes('vidact.v1.Renderable')) {
  throw new Error('shop client bundle is missing the compiled renderable capability marker')
}
if (!combined.includes('vidact.v1.ServerRenderable')) {
  throw new Error('shop server bundle is missing the compiled server renderable capability marker')
}
if (!combined.includes('Base UI')) {
  throw new Error('shop bundles do not contain the compiled Base UI implementation')
}

console.log(`Verified ${files.length} shop JavaScript bundles without a React runtime path.`)

function findForbidden(source) {
  return forbidden.filter(({ pattern }) => pattern.test(source)).map(({ label }) => label)
}

function stripRollupSourceMarkers(source) {
  return source.replace(/^\/\/#(?:end)?region .*$/gm, '')
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return javascriptFiles(path)
      return extname(entry.name) === '.js' ? [path] : []
    }),
  )
  return nested.flat()
}
