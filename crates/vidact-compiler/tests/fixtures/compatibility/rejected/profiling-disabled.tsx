import { Profiler } from 'react'

export function ProfilingDisabled(): Node {
  return (
    <Profiler id="disabled" onRender={() => undefined}>
      <p>disabled</p>
    </Profiler>
  )
}
