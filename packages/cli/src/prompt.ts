import type { Readable, Writable } from 'node:stream'

import { confirm, isCancel, select, text } from '@clack/prompts'

import { CliCancelledError } from './errors.ts'

export interface Choice {
  readonly value: string
  readonly title: string
  readonly description: string
}

export interface Prompter {
  text(question: string, fallback: string): Promise<string>
  choice(question: string, choices: readonly Choice[], fallback: string): Promise<string>
  confirm(question: string, fallback: boolean): Promise<boolean>
}

function unwrap<T>(answer: T | symbol): T {
  if (isCancel(answer)) throw new CliCancelledError()
  return answer as T
}

/**
 * A closed stdin would otherwise leave a prompt pending forever, so it aborts
 * the prompt the same way Ctrl+C does.
 */
function createAbortOnEndOfInput(input: Readable): AbortSignal {
  const controller = new AbortController()
  input.once('end', () => controller.abort())
  return controller.signal
}

export function createPrompter(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Prompter {
  const signal = createAbortOnEndOfInput(input)
  const streams = { input, output } as const

  return {
    async text(question, fallback) {
      const answer = unwrap(
        await text({
          ...streams,
          message: question,
          placeholder: fallback,
          defaultValue: fallback,
          signal,
        }),
      )
      return answer.trim().length === 0 ? fallback : answer.trim()
    },
    async choice(question, choices, fallback) {
      return unwrap(
        await select({
          ...streams,
          message: question,
          initialValue: fallback,
          signal,
          options: choices.map((choice) => ({
            value: choice.value,
            label: choice.title,
            hint: choice.description,
          })),
        }),
      )
    },
    async confirm(question, fallback) {
      return unwrap(await confirm({ message: question, initialValue: fallback, signal }))
    },
  }
}
