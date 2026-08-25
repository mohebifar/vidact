import { defineFileRoute, Link, type RouteComponentProps } from '@vidact/start'

export function RootLayout({ children }: RouteComponentProps<undefined>): JSX.Element {
  return (
    <div className="shell">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Vidact Start
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="/">Home</Link>
          <Link href="/products/compiler">Dynamic route</Link>
          <a href="/api/time">API route</a>
        </nav>
      </header>
      {children}
    </div>
  )
}

export const Route = defineFileRoute({ component: RootLayout })
