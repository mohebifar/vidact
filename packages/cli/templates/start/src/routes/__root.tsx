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
          <Link href="/about">About</Link>
        </nav>
      </header>
      {children}
    </div>
  )
}

export const Route = defineFileRoute({ component: RootLayout })
