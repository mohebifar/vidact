type ScheduledTask = () => void
export type CancelScheduledTask = () => void

type DeferredTask = {
  readonly run: ScheduledTask
  canceled: boolean
}

let tasks: ScheduledTask[] = []
let deferredTasks: DeferredTask[] = []
let microtaskScheduled = false
let deferredTurnScheduled = false
let flushing = false
let actDepth = 0

export function scheduleTask(task: ScheduledTask): void {
  tasks.push(task)
  requestFlush()
}

export function scheduleDeferredTask(task: ScheduledTask): CancelScheduledTask {
  const entry: DeferredTask = { run: task, canceled: false }
  deferredTasks.push(entry)
  requestDeferredTurn()
  return () => {
    entry.canceled = true
  }
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
    const deferred = deferredTasks
    tasks = []
    deferredTasks = []
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
    for (const task of deferred) {
      if (task.canceled) continue
      count += 1
      try {
        task.run()
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
    requestDeferredTurn()
  }
  if (failed) throw firstError
  return count
}

export function hasScheduledTasks(): boolean {
  return tasks.length > 0 || deferredTasks.some((task) => !task.canceled)
}

export function beginActScope(): void {
  actDepth += 1
}

export function endActScope(): void {
  actDepth -= 1
  requestFlush()
  requestDeferredTurn()
}

function requestFlush(): void {
  if (tasks.length === 0 || microtaskScheduled || flushing || actDepth > 0) return
  microtaskScheduled = true
  queueMicrotask(() => {
    microtaskScheduled = false
    if (actDepth === 0) flushScheduledTasks()
  })
}

function requestDeferredTurn(): void {
  if (
    deferredTasks.every((task) => task.canceled) ||
    deferredTurnScheduled ||
    flushing ||
    actDepth > 0
  ) {
    return
  }
  deferredTurnScheduled = true
  const channel = new MessageChannel()
  channel.port1.addEventListener(
    'message',
    () => {
      channel.port1.close()
      channel.port2.close()
      deferredTurnScheduled = false
      if (actDepth > 0 || flushing) {
        requestDeferredTurn()
        return
      }
      flushOneDeferredTask()
    },
    { once: true },
  )
  channel.port1.start()
  channel.port2.postMessage(undefined)
}

function flushOneDeferredTask(): void {
  let task: DeferredTask | undefined
  while ((task = deferredTasks.shift()) !== undefined && task.canceled) {}
  if (task === undefined) return
  try {
    task.run()
  } finally {
    requestFlush()
    requestDeferredTurn()
  }
}
