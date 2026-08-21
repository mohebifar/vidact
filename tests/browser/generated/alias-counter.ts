import { createStateSlot, createUpdaterScope, source, type StaticUpdater } from '@vidact/runtime'

export function mountAliasCounter(host: ParentNode) {
  const element = document.createElement('button')
  const text = document.createTextNode('')
  element.append(text)
  const trace: string[] = []
  let count!: ReturnType<typeof createStateSlot<number>>
  let alias!: number
  let direct!: number
  let doubled!: number
  const updaters: StaticUpdater[] = [
    { reads: source(1), writes: source(2), run: () => { trace.push('derived:direct'); direct = count.get() } },
    { reads: source(2), writes: source(0), run: () => { trace.push('derived:alias'); alias = direct } },
    { reads: source(0), writes: source(3), run: () => { trace.push('derived:doubled'); doubled = alias * 2 } },
    { reads: source(0), run: () => { trace.push('attribute:data-count'); element.setAttribute('data-count', String(alias)) } },
    { reads: source(3), run: () => { trace.push('text'); text.data = String(doubled) } },
  ]
  const scope = createUpdaterScope(updaters)
  count = createStateSlot(scope, source(1), 1)
  for (const updater of updaters) updater.run()
  trace.length = 0
  const handleClick = () => count.set((previous) => previous + 1)
  element.addEventListener('click', handleClick)
  const dispose = () => {
    element.removeEventListener('click', handleClick)
    scope.dispose()
  }
  host.append(element)
  return { element, setCount: count.set, batch: scope.batch, trace, dispose }
}
