import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

const loader = () => ({ renderedAt: new Date().toISOString() })

export function HomeRoute({
  loaderData,
}: RouteComponentProps<ReturnType<typeof loader>>): JSX.Element {
  return (
    <main className="hero">
      <p className="eyebrow">File routes · Loaders · SSR · Hydration</p>
      <h1>React in, DOM out.</h1>
      <p className="lede">
        This page was selected from the routes directory, loaded on the server, rendered through
        Vidact, and hydrated from the same generated manifest.
      </p>
      <dl className="proof">
        <div>
          <dt>Route</dt>
          <dd>src/routes/index.tsx</dd>
        </div>
        <div>
          <dt>Server render</dt>
          <dd>{loaderData.renderedAt}</dd>
        </div>
      </dl>
    </main>
  )
}

export const Route = defineFileRoute({ loader, component: HomeRoute })
