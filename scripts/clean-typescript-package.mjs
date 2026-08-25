import { rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const [outputArgument] = process.argv.slice(2)
if (outputArgument === undefined) throw new Error('expected an output directory')

const outputDirectory = path.resolve(outputArgument)
if (path.basename(outputDirectory) !== 'dist') {
  throw new Error(`refusing to clean non-dist output directory: ${outputDirectory}`)
}

await rm(outputDirectory, { force: true, recursive: true })
