import { Profiler, captureOwnerStack, useDebugValue, useLayoutEffect, useState } from 'react'

export type ProfileCommit = readonly [
  id: string,
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
]

const commits: ProfileCommit[] = []
let latestOwnerStack: string | null = null
let standaloneOwnerStack: string | null = null

export function readProfileCommits(): readonly ProfileCommit[] {
  return commits
}

export function readLatestOwnerStack(): string | null {
  return latestOwnerStack
}

export function readStandaloneOwnerStack(): string | null {
  return standaloneOwnerStack
}

export function resetProfilingTrace(): void {
  commits.length = 0
  latestOwnerStack = null
  standaloneOwnerStack = null
  performance.clearMeasures()
}

function StandaloneDebugValue(): JSX.Element {
  useDebugValue('standalone')
  return (
    <button data-capture-standalone onClick={() => (standaloneOwnerStack = captureOwnerStack())}>
      capture standalone owner
    </button>
  )
}

function ProfiledCounter(): JSX.Element {
  const [count, setCount] = useState(0)
  useDebugValue(count, (value) => `count:${value}`)
  useLayoutEffect(() => undefined, [count])
  return (
    <section data-profiled-counter>
      <button data-increment onClick={() => setCount((value) => value + 1)}>
        increment
      </button>
      <button data-capture-owner onClick={() => (latestOwnerStack = captureOwnerStack())}>
        capture owner
      </button>
      <output data-count>{count}</output>
      <span data-stable>stable</span>
    </section>
  )
}

export function ProfilingApp(): JSX.Element {
  const onRender = (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
  ): void => {
    commits.push([id, phase, actualDuration, baseDuration, startTime, commitTime])
  }
  return (
    <>
      <StandaloneDebugValue />
      <Profiler id="root" onRender={onRender}>
        <Profiler id="counter" onRender={onRender}>
          <ProfiledCounter />
        </Profiler>
      </Profiler>
    </>
  )
}
