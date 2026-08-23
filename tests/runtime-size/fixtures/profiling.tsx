import { mountCompiled } from '@vidact/runtime/profiling'
import { Profiler, captureOwnerStack, useDebugValue, useState } from 'react'

function Counter(): JSX.Element {
  const [count, setCount] = useState(0)
  useDebugValue(count)
  return <button onClick={() => setCount(count + 1)}>{captureOwnerStack() ?? count}</button>
}

function Profiled(): JSX.Element {
  return (
    <Profiler id="counter" onRender={() => undefined}>
      <Counter />
    </Profiler>
  )
}

mountCompiled(Profiled, document.body)
