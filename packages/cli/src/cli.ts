#!/usr/bin/env node
import process from 'node:process'

import { run } from './run.ts'
import { readCliVersion } from './version.ts'

process.exitCode = await run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  version: readCliVersion(),
})
