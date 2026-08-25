import { readCompiledOwnerMetrics as readOwnerMetrics } from './compiled/core.ts'
import {
  beginActScope as beginSchedulerActScope,
  endActScope as endSchedulerActScope,
  flushScheduledTasks as flushSchedulerTasks,
  hasScheduledTasks as schedulerHasTasks,
} from './scheduler.ts'

export function beginActScope(): void {
  beginSchedulerActScope()
}

export function endActScope(): void {
  endSchedulerActScope()
}

export function flushScheduledTasks(): number {
  return flushSchedulerTasks()
}

export function hasScheduledTasks(): boolean {
  return schedulerHasTasks()
}

export function readCompiledOwnerMetrics(): ReturnType<typeof readOwnerMetrics> {
  return readOwnerMetrics()
}
