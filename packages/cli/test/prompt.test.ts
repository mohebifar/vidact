import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { CliCancelledError } from '../src/errors.ts'
import { createPrompter } from '../src/prompt.ts'

const choices = [
  { value: 'spa', title: 'Single-page app', description: 'Vite and the compiler plugin' },
  { value: 'start', title: 'Full-stack app', description: 'File routes and server rendering' },
]

const ENTER = '\r'
const DOWN = '\u001b[B'
const CTRL_C = '\u0003'

function createStreams(): {
  input: PassThrough
  output: PassThrough
  rendered: () => string
} {
  const input = new PassThrough()
  Object.assign(input, { isTTY: true, setRawMode: () => input })
  const output = new PassThrough()
  const chunks: string[] = []
  output.on('data', (chunk: Buffer) => void chunks.push(chunk.toString()))
  return { input, output, rendered: () => chunks.join('') }
}

// Confirmation prompts are covered through the injected prompter in the run tests:
// Clack's confirm never sees keypresses under Vitest's stdin handling, though it
// works in a real terminal and under plain Node.
describe('the interactive prompter', () => {
  it('takes the default when the answer is empty', async () => {
    const { input, output, rendered } = createStreams()
    const answer = createPrompter(input, output).text('Project directory', 'vidact-app')
    input.write(ENTER)
    expect(await answer).toBe('vidact-app')
    expect(rendered()).toContain('Project directory')
  })

  it('reads a typed answer', async () => {
    const { input, output } = createStreams()
    const answer = createPrompter(input, output).text('Project directory', 'vidact-app')
    input.write('my-app')
    input.write(ENTER)
    expect(await answer).toBe('my-app')
  })

  it('selects a template with the arrow keys', async () => {
    const { input, output, rendered } = createStreams()
    const answer = createPrompter(input, output).choice('Which template?', choices, 'spa')
    input.write(DOWN)
    input.write(ENTER)
    expect(await answer).toBe('start')
    expect(rendered()).toContain('Full-stack app')
  })

  it('cancels on Ctrl+C', async () => {
    const { input, output } = createStreams()
    const answer = createPrompter(input, output).text('Project directory', 'vidact-app')
    input.write(CTRL_C)
    await expect(answer).rejects.toThrow(CliCancelledError)
  })

  it('cancels when input ends instead of hanging', async () => {
    const { input, output } = createStreams()
    const answer = createPrompter(input, output).text('Project directory', 'vidact-app')
    input.end()
    await expect(answer).rejects.toThrow(CliCancelledError)
  })
})
