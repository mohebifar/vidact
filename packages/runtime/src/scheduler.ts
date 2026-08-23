type ScheduledTask = () => void

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
let tasks: ScheduledTask[] = []
let microtaskScheduled = false
let flushing = false
let actDepth = 0

export function scheduleTask(task: ScheduledTask): void {
  if (!DEV) {
    queueMicrotask(task)
    return
  }
  tasks.push(task)
  requestFlush()
}

export function flushScheduledTasks(): number {
  if (flushing) return 0
  flushing = true
  microtaskScheduled = false
  let firstError: unknown
  let failed = false
  let count = 0
  try {
    const queued = tasks
    tasks = []
    for (const task of queued) {
      count += 1
      try {
        task()
      } catch (error) {
        if (!failed) {
          firstError = error
          failed = true
        }
      }
    }
  } finally {
    flushing = false
    requestFlush()
  }
  if (failed) throw firstError
  return count
}

export function hasScheduledTasks(): boolean {
  return tasks.length > 0
}

export function beginActScope(): void {
  actDepth += 1
}

export function endActScope(): void {
  actDepth -= 1
  requestFlush()
}

function requestFlush(): void {
  if (tasks.length === 0 || microtaskScheduled || flushing || actDepth > 0) return
  microtaskScheduled = true
  queueMicrotask(() => {
    microtaskScheduled = false
    if (actDepth === 0) flushScheduledTasks()
  })
}
