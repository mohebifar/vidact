import {
  beginActScope,
  endActScope,
  flushScheduledTasks,
  hasScheduledTasks,
} from '@vidact/runtime/testing'

const MAX_ACT_PASSES = 100

export async function act<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
  beginActScope()
  let result!: Result
  let failure: unknown
  let failed = false
  try {
    try {
      result = await operation()
    } catch (error) {
      failure = error
      failed = true
    }
    try {
      await drainActWork()
    } catch (error) {
      if (!failed) {
        failure = error
        failed = true
      }
    }
  } finally {
    endActScope()
  }
  if (failed) throw failure
  return result
}

async function drainActWork(): Promise<void> {
  for (let pass = 0; pass < MAX_ACT_PASSES; pass += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Each turn must observe work scheduled by the previous drain.
    await Promise.resolve()
    const flushed = flushScheduledTasks()
    // oxlint-disable-next-line no-await-in-loop -- Native promise jobs may enqueue more Vidact work.
    await Promise.resolve()
    if (flushed === 0 && !hasScheduledTasks()) return
  }
  throw new Error('Vidact act work did not stabilize')
}
