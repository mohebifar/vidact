export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

/** Thrown when the person answering a prompt presses Ctrl+C. */
export class CliCancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CliCancelledError'
  }
}
