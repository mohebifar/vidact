import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const contractPath = path.join(repository, 'docs', 'react-compatibility.md')
const contract = await readFile(contractPath, 'utf8')
const vitePackage = JSON.parse(
  await readFile(path.join(repository, 'packages', 'vite-plugin', 'package.json'), 'utf8'),
)
const baseUiVersion = vitePackage.devDependencies?.['@base-ui/react']
const startMarker = '<!-- compatibility-evidence:start -->'
const endMarker = '<!-- compatibility-evidence:end -->'
const start = contract.indexOf(startMarker)
const end = contract.indexOf(endMarker)

if (start === -1 || end === -1 || end <= start) {
  throw new Error('compatibility evidence table markers are missing or out of order')
}

const section = contract.slice(start + startMarker.length, end)
const rows = section
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .slice(2)
if (rows.length === 0) throw new Error('compatibility evidence table has no claims')
if (typeof baseUiVersion !== 'string' || !section.includes(`Base UI ${baseUiVersion}`)) {
  throw new Error('compatibility evidence must name the tested Base UI devDependency version')
}

const browserConfig = await readFile(
  path.join(repository, 'tests', 'browser', 'vitest.base-ui.config.ts'),
  'utf8',
)
for (const browser of ['chromium', 'firefox', 'webkit']) {
  if (!browserConfig.includes(`browser: '${browser}'`)) {
    throw new Error(`Base UI browser evidence is missing the ${browser} instance`)
  }
}

const evidencePaths = new Set()
for (const row of rows) {
  const links = [...row.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/gu)]
  if (links.length === 0) throw new Error(`compatibility claim has no evidence link: ${row}`)
  for (const link of links) evidencePaths.add(link[1])
}

await Promise.all(
  [...evidencePaths].map(async (evidencePath) => {
    const filename = path.resolve(path.dirname(contractPath), evidencePath)
    const source = await readFile(filename, 'utf8').catch(() => undefined)
    if (source === undefined) throw new Error(`compatibility evidence is missing: ${evidencePath}`)
    if (!/(?:\bit(?:\.each)?|\btest)\s*\(|#\[test\]|@ts-expect-error/u.test(source)) {
      throw new Error(`compatibility evidence is not an executable test fixture: ${evidencePath}`)
    }
  }),
)

process.stdout.write(`compatibility evidence: ${rows.length} claims, ${evidencePaths.size} files\n`)
