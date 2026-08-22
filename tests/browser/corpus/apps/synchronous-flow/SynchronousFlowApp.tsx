import { useState } from 'react'

export function SynchronousFlowApp(): JSX.Element {
  const [mode, setMode] = useState<'a' | 'b'>('a')
  const [values, setValues] = useState([1, -1, 2, 99, 10])

  let label = ''
  switch (mode) {
    case 'a':
      label += 'a'
    case 'b':
      label += 'b'
      break
    default:
      label = 'other'
  }

  let retainedTotal = 0
  valuesLoop: for (const value of values) {
    if (value === 99) break valuesLoop
    if (value < 0) continue
    retainedTotal += value
  }

  let indexedTotal = 0
  for (let index = 0; index < values.length; index += 1) {
    indexedTotal += values[index]!
  }

  let keys = ''
  for (const key in values) {
    keys += key
  }

  let whileCount = 0
  while (whileCount < values.length) {
    whileCount += 1
  }

  let doWhileCount = 0
  do {
    doWhileCount += 1
  } while (doWhileCount < values.length)

  return (
    <section data-synchronous-flow>
      <output data-switch>{label}</output>
      <output data-for-of>{retainedTotal}</output>
      <output data-for>{indexedTotal}</output>
      <output data-for-in>{keys}</output>
      <output data-while>{whileCount}</output>
      <output data-do-while>{doWhileCount}</output>
      <button data-mode-b onClick={() => setMode('b')}>
        mode b
      </button>
      <button data-short-values onClick={() => setValues([4, 5])}>
        short values
      </button>
      <button data-noop onClick={() => setValues((current) => current)}>
        noop
      </button>
    </section>
  )
}
