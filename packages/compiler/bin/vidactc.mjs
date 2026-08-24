#!/usr/bin/env node

import process from 'node:process'

import { analyzeSync, compileSync } from '../dist/index.js'

function parseArguments(arguments_) {
  const [command, filenameFlag, filename, ...rest] = arguments_
  if (!['analyze', 'compile'].includes(command) || filenameFlag !== '--filename' || !filename) {
    throw new Error('usage: vidactc <analyze|compile> --filename <path>')
  }
  let target = 'client'
  const features = []
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    const value = rest[index + 1]
    if (argument === '--target' && value !== undefined) {
      target = value
      index += 1
    } else if (argument === '--feature' && value !== undefined) {
      features.push(value)
      index += 1
    } else {
      throw new Error(`unexpected argument ${String(argument)}`)
    }
  }
  return { command, filename, target, features }
}

try {
  const options = parseArguments(process.argv.slice(2))
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const source = Buffer.concat(chunks).toString('utf8')
  const compilerOptions = {
    filename: options.filename,
    target: options.target,
    features: options.features,
  }
  const output =
    options.command === 'compile'
      ? compileSync(source, compilerOptions)
      : analyzeSync(source, { filename: options.filename })
  process.stdout.write(`${JSON.stringify(output)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
