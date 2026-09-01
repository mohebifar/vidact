import { defineFileRoute, Link } from '@vidact/start'

import { ArrowIcon } from '@/components/icons.tsx'
import { Badge } from '@/components/ui/badge.tsx'
import { ButtonLink } from '@/components/ui/button.tsx'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx'

export function HomeRoute() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
          <Link className="flex items-center gap-2 font-semibold" href="/">
            <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-bold text-background">
              V
            </span>
            Vidact
          </Link>
          <nav className="ml-auto flex items-center gap-5 text-sm text-muted-foreground">
            <Link className="hover:text-foreground" href="/docs">
              Docs
            </Link>
            <a className="hover:text-foreground" href="https://github.com/mohebifar/vidact">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <Badge variant="secondary">Experimental · 0.2 beta</Badge>
        <h1 className="mt-6 max-w-4xl text-5xl font-bold tracking-tight sm:text-7xl">
          React-shaped source. Direct DOM output.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
          Vidact compiles function components into stable DOM owners and static, surgical updates.
          No Virtual DOM, runtime dependency tracking, or React fallback.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <ButtonLink href="/docs/tutorials/first-application">
            Start the tutorial <ArrowIcon className="size-4" />
          </ButtonLink>
          <ButtonLink href="/docs/reference/react-compatibility" variant="outline">
            Check compatibility
          </ButtonLink>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-24 md:grid-cols-3">
        <Feature
          title="Construct once"
          description="Function components create their owned DOM once for each mount."
        />
        <Feature
          title="Update surgically"
          description="State writes run compiler-selected text, prop, range, and effect work."
        />
        <Feature
          title="Fail closed"
          description="Unsupported React patterns receive diagnostics instead of a runtime fallback."
        />
      </section>
    </main>
  )
}

function Feature({ description, title }: { readonly description: string; readonly title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export const Route = defineFileRoute({ component: HomeRoute })
