import type { DocCodeLine } from './docs-types.ts'
import { highlightLines } from './mdx.server.ts'

const counterSource = `import { useState } from 'react'

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

const formSource = `import { useState } from 'react'

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

const listSource = `import { useState } from 'react'

export function Playlist() {
  const [songs, setSongs] = useState(SONGS)

  return (
    <div>
      <button onClick={() => setSongs(songs.toReversed())}>
        Reverse
      </button>
      <ul>
        {songs.map((song) => (
          <li key={song.id}>
            <input type="checkbox" /> {song.title}
          </li>
        ))}
      </ul>
    </div>
  )
}`

const branchSource = `import { useState } from 'react'

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

const routeSource = `import { defineFileRoute } from '@vidact/start'

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

export type LandingData = {
  readonly branch: readonly DocCodeLine[]
  readonly counter: readonly DocCodeLine[]
  readonly form: readonly DocCodeLine[]
  readonly list: readonly DocCodeLine[]
  readonly route: readonly DocCodeLine[]
}

export async function loadLandingRoute(): Promise<LandingData> {
  return {
    branch: highlightLines(branchSource, 'tsx', 'branch'),
    counter: highlightLines(counterSource, 'tsx', 'counter'),
    form: highlightLines(formSource, 'tsx', 'form'),
    list: highlightLines(listSource, 'tsx', 'list'),
    route: highlightLines(routeSource, 'tsx', 'route'),
  }
}
