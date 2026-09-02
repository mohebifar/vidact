import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

type TransitionSnapshot = {
  mounted: boolean
  status: string
}

class TransitionStore {
  state: TransitionSnapshot = { mounted: false, status: 'closed' }
  listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  update(next: TransitionSnapshot) {
    if (this.state.mounted === next.mounted && this.state.status === next.status) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function useSyncedTransitionStore(store: TransitionStore, statePart: TransitionSnapshot) {
  const dependencies = Object.values(statePart)
  useLayoutEffect(() => store.update(statePart), [store, ...dependencies])
}

function readExceptionMode(mode: string): string {
  if (mode === 'caught') throw new Error('caught')
  return mode
}

function useRenderPhaseStatus(open: boolean) {
  const [status, setStatus] = useState('closed')
  const [mounted, setMounted] = useState(false)

  if (open && !mounted) {
    setMounted(true)
    setStatus('opening')
  }
  if (!open && mounted && status !== 'closing') {
    setStatus('closing')
  }

  return { mounted, status }
}

export function SynchronousFlowApp(): JSX.Element {
  const [mode, setMode] = useState<'a' | 'b'>('a')
  const [values, setValues] = useState([1, -1, 2, 99, 10])
  const [rows, setRows] = useState([
    { id: 'ada', label: 'Ada' },
    { id: 'grace', label: 'Grace' },
  ])
  const [exceptionMode, setExceptionMode] = useState('normal')
  const [phaseOpen, setPhaseOpen] = useState(false)
  const [transitionStore, setTransitionStore] = useState(() => new TransitionStore())
  const { mounted: phaseMounted, status: phaseStatus } = useRenderPhaseStatus(phaseOpen)
  const transitionStatePart = { mounted: phaseMounted, status: phaseStatus }
  useSyncedTransitionStore(transitionStore, transitionStatePart)
  const transitionSnapshot = useSyncExternalStore(
    transitionStore.subscribe,
    transitionStore.getSnapshot,
  )

  useLayoutEffect(() => {
    Reflect.set(globalThis, '__vidactRenderPhaseMounted', phaseMounted)
  }, [phaseMounted])

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

  const keyedLoopRows = []
  for (const row of rows) {
    keyedLoopRows.push(
      <li key={row.id} data-keyed-row-id={row.id}>
        <input aria-label={`keyed-${row.id}`} />
        <span>{row.label}</span>
      </li>,
    )
  }

  let exceptionLabel = ''
  try {
    exceptionLabel = readExceptionMode(exceptionMode)
  } catch (error) {
    exceptionLabel = error instanceof Error ? error.message : 'unknown'
  }

  return (
    <section data-synchronous-flow>
      <output data-switch>{label}</output>
      <output data-for-of>{retainedTotal}</output>
      <output data-for>{indexedTotal}</output>
      <output data-for-in>{keys}</output>
      <output data-while>{whileCount}</output>
      <output data-do-while>{doWhileCount}</output>
      <output data-try-catch>{exceptionLabel}</output>
      <output data-render-phase-sync data-mounted={phaseMounted}>
        {phaseStatus}
      </output>
      <output data-synced-transition-store data-mounted={transitionSnapshot.mounted}>
        {transitionSnapshot.status}
      </output>
      <ul data-indexed-list>
        {rows.map((row, index) => (
          <li data-row-id={row.id} data-row-index={index}>
            <input aria-label={`owner-${index}`} />
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      <ol data-keyed-loop-list>{keyedLoopRows}</ol>
      <button data-mode-b onClick={() => setMode('b')}>
        mode b
      </button>
      <button data-short-values onClick={() => setValues([4, 5])}>
        short values
      </button>
      <button data-noop onClick={() => setValues((current) => current)}>
        noop
      </button>
      <button
        data-prepend-row
        onClick={() => setRows((current) => [{ id: 'new', label: 'New' }, ...current])}
      >
        prepend row
      </button>
      <button data-reverse-rows onClick={() => setRows((current) => current.toReversed())}>
        reverse rows
      </button>
      <button data-truncate-rows onClick={() => setRows((current) => current.slice(0, 1))}>
        truncate rows
      </button>
      <button
        data-update-row
        onClick={() =>
          setRows((current) =>
            current.map((row) => (row.id === 'ada' ? { ...row, label: 'ADA' } : row)),
          )
        }
      >
        update row
      </button>
      <button data-catch-error onClick={() => setExceptionMode('caught')}>
        catch error
      </button>
      <button data-toggle-render-phase onClick={() => setPhaseOpen(!phaseOpen)}>
        toggle render phase
      </button>
      <button
        data-replace-transition-store
        onClick={() => setTransitionStore(new TransitionStore())}
      >
        replace transition store
      </button>
    </section>
  )
}
