import { Profiler, captureOwnerStack, useDebugValue } from 'react'

function ProfiledChild(): Node {
  useDebugValue('child')
  return <output data-owner={captureOwnerStack()}>profiled</output>
}

export function ProfiledApp(): Node {
  return (
    <Profiler id="app" onRender={() => undefined}>
      <ProfiledChild />
    </Profiler>
  )
}
