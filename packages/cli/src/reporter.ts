import { intro, log, note, outro, spinner } from '@clack/prompts'

export interface Reporter {
  intro(message: string): void
  info(message: string): void
  success(message: string): void
  warn(message: string): void
  error(message: string): void
  note(title: string, body: string): void
  task<T>(label: string, run: () => Promise<T>): Promise<T>
  outro(message: string): void
}

export function createClackReporter(): Reporter {
  return {
    intro: (message) => intro(message),
    info: (message) => log.info(message),
    success: (message) => log.success(message),
    warn: (message) => log.warn(message),
    error: (message) => log.error(message),
    note: (title, body) => note(body, title),
    async task(label, run) {
      const progress = spinner()
      progress.start(label)
      try {
        const result = await run()
        progress.stop(label)
        return result
      } catch (error) {
        progress.error(label)
        throw error
      }
    },
    outro: (message) => outro(message),
  }
}

/** Line-oriented output for pipes, CI, and tests, with the same wording. */
export function createPlainReporter(write: (message: string) => void): Reporter {
  const line = (message: string) => write(`${message}\n`)
  return {
    intro: line,
    info: line,
    success: line,
    warn: line,
    error: line,
    note: (title, body) => write(`\n${title}\n${body}\n`),
    async task(label, run) {
      line(label)
      return await run()
    },
    outro: line,
  }
}
