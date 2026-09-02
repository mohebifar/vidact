/**
 * Sources shown on the landing page. `counterSource` is also the input to
 * `compiledCounter`, which is the real output of `compileSync` checked in so the
 * page can display it without loading the native compiler on the server.
 * `test/compiled-counter.test.ts` recompiles the source and fails when the two
 * drift apart.
 */

export const counterSource = `import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
      <output>Count: {count}</output>
    </div>
  )
}`

export const compiledCounter = `import { binding as __vidactBinding, compiledEvent as __vidactEvent, compiledRoot as __vidactCompiledRoot, createNarrowCompiledScope as __vidactCreateNarrowScope, createCompiledState as __vidactCreateState } from "@vidact/runtime";
export function Counter() {
	const __vidactScope = __vidactCreateNarrowScope();
	const count = __vidactCreateState(__vidactScope, 1, 0);
	return __vidactCompiledRoot(__vidactScope, () => <div>
      <button onClick={__vidactEvent(__vidactScope, () => count.set(count.get() + 1))}>
        Increment
      </button>
      <output>Count: {__vidactBinding(__vidactScope, 1, () => count.get())}</output>
    </div>);
}`

export const formSource = `import { useState } from 'react'

export function Greeting() {
  const [name, setName] = useState('')

  return (
    <form>
      <input
        placeholder="Your name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p>Hi, {name === '' ? 'stranger.' : \`\${name}!\`}</p>
    </form>
  )
}`

export const listSource = `import { useState } from 'react'

export function Engines() {
  const [engines, setEngines] = useState(ENGINES)

  return (
    <div>
      <button onClick={() => setEngines(engines.toReversed())}>
        Reverse
      </button>
      <ul>
        {engines.map((engine) => (
          <li key={engine.id}>
            <input type="checkbox" /> {engine.name}
          </li>
        ))}
      </ul>
    </div>
  )
}`

export const branchSource = `import { useState } from 'react'

export function Loader() {
  const [state, setState] = useState('idle')
  const load = () => {
    setState('loading')
    window.setTimeout(() => setState('ready'), 900)
  }

  if (state === 'loading') return <p>Loading…</p>
  if (state === 'ready') return <p>Loaded.</p>

  return <button onClick={load}>Load data</button>
}`

export const routeSource = `import { defineFileRoute } from '@vidact/start'

const loader = async ({ params }) => ({
  product: await findProduct(params.productId),
})

export function ProductRoute({ loaderData }) {
  return <h1>{loaderData.product.name}</h1>
}

export const Route = defineFileRoute({
  loader,
  component: ProductRoute,
})`

/** Verbatim compiler output for a class component and a misspelled event prop. */
export const rejectionOutput = [
  'src/Clock.tsx:3:28: UnsupportedSyntax: React class components are unsupported; use a function component and Vidact errorBoundary',
  'src/Toggle.tsx:5:18: UnsupportedSyntax: unsupported React event prop onWiggle; use a supported React 19 event name',
] as const
