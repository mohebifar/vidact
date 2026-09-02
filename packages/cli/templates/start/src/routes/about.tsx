import { defineFileRoute } from '@vidact/start'

export function AboutRoute(): JSX.Element {
  return (
    <main className="hero">
      <h1>About</h1>
      <p className="lede">
        Add a file under <code>src/routes</code> and it becomes a route. Export a{' '}
        <code>loader</code> to fetch data on the server before the component renders.
      </p>
    </main>
  )
}

export const Route = defineFileRoute({ component: AboutRoute })
