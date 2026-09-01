import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

type Snapshot = {
  mounted: boolean
  status: string
}

class Store {
  state: Snapshot = { mounted: false, status: 'closed' }
  listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  update(next: Snapshot) {
    if (this.state.mounted === next.mounted && this.state.status === next.status) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

class OpenStore {
  value = false
  listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.value

  open() {
    if (this.value) return
    this.value = true
    for (const listener of this.listeners) listener()
  }
}

function useTransitionStatus(open: boolean): Snapshot {
  const [mounted, setMounted] = useState(open)
  const [status, setStatus] = useState(open ? 'open' : 'closed')

  if (open && !mounted) {
    setMounted(true)
    setStatus('opening')
  }

  return { mounted, status }
}

function useSyncedValues(store: Store, statePart: Snapshot) {
  const dependencies = Object.values(statePart)
  useLayoutEffect(() => store.update(statePart), [store, ...dependencies])
}

export function RenderPhaseStoreApp(): JSX.Element {
  const [openStore, setOpenStore] = useState(() => new OpenStore())
  const [store, setStore] = useState(() => new Store())
  const open = useSyncExternalStore(openStore.subscribe, openStore.getSnapshot)
  const statePart = useTransitionStatus(open)
  useSyncedValues(store, statePart)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return (
    <section data-render-phase-store>
      <output data-store-mounted={snapshot.mounted}>{snapshot.status}</output>
      <button onClick={() => openStore.open()}>open</button>
      <button onClick={() => setOpenStore(new OpenStore())}>replace open store</button>
      <button onClick={() => setStore(new Store())}>replace store</button>
    </section>
  )
}
