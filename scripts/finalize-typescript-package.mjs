import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [outputArgument, ...copiedFiles] = process.argv.slice(2)
if (outputArgument === undefined) throw new Error('expected an output directory')

const outputDirectory = path.resolve(outputArgument)

await Promise.all(
  copiedFiles.map((sourceArgument) => {
    const source = path.resolve(sourceArgument)
    return copyFile(source, path.join(outputDirectory, path.basename(source)))
  }),
)

const entries = await readdir(outputDirectory, { recursive: true, withFileTypes: true })
await Promise.all(
  entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map(async (entry) => {
      const filename = path.join(entry.parentPath, entry.name)
      const source = await readFile(filename, 'utf8')
      const rewritten = source.replaceAll(
        /((?:from\s+|import\s*\()['"][^'"]+)\.ts(['"])/g,
        '$1.js$2',
      )
      if (rewritten !== source) await writeFile(filename, rewritten)
    }),
)
