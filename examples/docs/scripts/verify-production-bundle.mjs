import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const distributionRoot = join(projectRoot, 'dist')
const forbidden = [
  ['React package import', /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\()\s*["']react(?:-dom)?(?:\/[^"']*)?["']/],
  ['React element tag', /react\.(?:element|transitional\.element)|REACT_ELEMENT_TYPE|\$\$typeof/],
  ['React DOM renderer', /\b(?:createRoot|hydrateRoot|createFiber|reconcileChildFibers)\s*\(/],
  ['React compatibility adapter', /vidact-react-compat-adapter|react-reconciler/],
]

const verifierSeeds = [
  'import React from "react"',
  'import "react"',
  'const element = { $$typeof: Symbol.for("react.element") }',
  'hydrateRoot(host, tree)',
  '/* vidact-react-compat-adapter */',
]

for (const seed of verifierSeeds) {
  if (findForbidden(seed).length === 0) {
    throw new Error(`Production bundle verifier failed to reject its seed: ${seed}`)
  }
}

const files = await javascriptFiles(distributionRoot)
if (files.length === 0) throw new Error('Docs production bundle is missing.')

const failures = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const label of findForbidden(source)) {
    failures.push(`${relative(projectRoot, file)}: ${label}`)
  }
}

if (failures.length > 0) {
  throw new Error(`Docs production bundle contains forbidden React paths:\n${failures.join('\n')}`)
}

console.log(`Verified ${files.length} docs JavaScript bundles without a React runtime path.`)

function findForbidden(source) {
  return forbidden
    .filter(([, pattern]) => pattern.test(source))
    .map(([label]) => label)
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFiles(path)
    return extname(entry.name) === '.js' ? [path] : []
  }))
  return nested.flat()
}
