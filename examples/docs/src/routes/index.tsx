import type { VidactNode } from '@vidact/react-types'
import { defineFileRoute, Link, type RouteComponentProps } from '@vidact/start'
import { useEffect, useRef, useState } from 'react'

import { ArrowIcon } from '@/components/icons.tsx'
import { Button, ButtonLink } from '@/components/ui/button.tsx'
import type { DocCodeLine } from '@/lib/docs-types.ts'
import { mountHeroLogo } from '@/lib/hero-logo-mount.ts'
import { loadLandingData } from '@/lib/landing-loader.ts'
import { rejectionOutput } from '@/lib/landing-samples.ts'

const loader = () => loadLandingData()

type LandingData = Awaited<ReturnType<typeof loader>>
type LandingProps = RouteComponentProps<LandingData>

export function HomeRoute({ loaderData }: LandingProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      {/* The hero and the compiled-output panes share one dark slab, so the
          first thing below the headline is the compiler's actual output. */}
      <div className="bg-zinc-950 text-white">
        <section className="relative overflow-hidden">
          <HeroLogo />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-linear-to-r from-zinc-950 via-zinc-950/45 via-30% to-transparent to-65%"
          />
          <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-24">
            <h1 className="font-display max-w-3xl text-5xl font-bold tracking-tight text-balance sm:text-7xl">
              React, compiled to VanillaJS
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">
              Vidact reads your function components at build time and writes the DOM code for them.
              The component body runs once, at mount. A{' '}
              <code className="text-zinc-200">setState</code> call after that reaches only the text
              nodes and attributes that read that state.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200"
                href="/docs/getting-started/quick-start"
              >
                Get started <ArrowIcon className="size-4" />
              </Link>
              <code className="inline-flex h-10 items-center rounded-md border border-white/15 px-4 font-mono text-sm text-zinc-300">
                npx vidact my-app
              </code>
            </div>
            <p className="mt-6 max-w-xl text-sm text-zinc-500">
              Beta. Vidact compiles a{' '}
              <Link
                className="text-zinc-300 underline underline-offset-4"
                href="/docs/reference/react-compatibility"
              >
                documented subset
              </Link>{' '}
              of React 19 and refuses the rest at build time.
            </p>
          </div>
        </section>
      </div>

      <Examples data={loaderData} />

      <Measurements />

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            There is a framework around it
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Vidact Start adds file routes, server loaders, SSR, hydration, and client navigation.
            The same compiler produces the server and the browser build, so the markup the server
            sends and the DOM the client hydrates come from one description of the component.
          </p>
          <Link
            className="decoration-muted-foreground/60 mt-6 inline-flex items-center gap-2 font-medium underline underline-offset-4 hover:decoration-current"
            href="/docs/start/getting-started"
          >
            Read the Start guide <ArrowIcon className="size-4" />
          </Link>
        </div>
        <CodePane filename="src/routes/products/$productId.tsx" lines={loaderData.route} rounded />
      </section>

      <Limits />

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Vidact</span>
          <Link className="hover:text-foreground" href="/docs">
            Docs
          </Link>
          <Link className="hover:text-foreground" href="/docs/guides/migrating-from-react">
            Migrate from React
          </Link>
          <Link className="hover:text-foreground" href="/docs/internals/compilation">
            Internals
          </Link>
          <a className="hover:text-foreground" href="https://github.com/mohebifar/vidact">
            GitHub
          </a>
        </div>
      </footer>
    </main>
  )
}

/**
 * Lazily mounts the crystal logo once the hero is on screen, so the renderer
 * never blocks the initial page load. Exported for the browser proof tests.
 */
export function HeroLogo() {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    return mountHeroLogo(host)
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-60 lg:opacity-100"
      data-testid="hero-logo"
      ref={hostRef}
    />
  )
}

function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-zinc-950 text-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center px-6">
        <Link className="flex items-center gap-2 font-semibold" href="/">
          <img
            alt=""
            className="size-7"
            height="28"
            src="/logo-64-dark.png"
            srcSet="/logo-64-dark.png 1x, /logo-128-dark.png 2x"
            width="28"
          />
          Vidact
        </Link>
        <nav className="ml-auto flex items-center gap-5 text-sm text-zinc-400">
          <Link className="hover:text-white" href="/docs">
            Docs
          </Link>
          <Link className="hover:text-white" href="/docs/learn/thinking-in-vidact">
            Learn
          </Link>
          <a className="hover:text-white" href="https://github.com/mohebifar/vidact">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  )
}

function Measurements() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="grid gap-10 sm:grid-cols-3">
          <Measurement
            label="A counter app, runtime included"
            note="tests/runtime-size/fixtures/counter.tsx"
            value="8.0 kB"
          />
          <Measurement
            label="TodoMVC, runtime included"
            note="examples/todomvc/src/TodoApp.tsx"
            value="11.8 kB"
          />
          <Measurement
            label="Component calls after mount"
            note="the body runs once, at mount"
            value="0"
          />
        </div>
        <p className="mt-10 max-w-2xl text-sm leading-6 text-muted-foreground">
          Bundle sizes are gzipped
        </p>
      </div>
    </section>
  )
}

function Measurement({
  label,
  note,
  value,
}: {
  readonly label: string
  readonly note: string
  readonly value: string
}) {
  return (
    <div className="border-t pt-5">
      <p className="font-display text-4xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 font-medium">{label}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function Limits() {
  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            What it refuses
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Class components, <code>createRef</code>, most of the <code>Children</code> helpers, and
            React DevTools are outside the subset. So is any third-party package that ships
            precompiled against React's runtime rather than React-shaped source.
          </p>
          <p className="mt-4 leading-7 text-muted-foreground">
            None of that degrades quietly. The compiler stops the build at the line that caused it
            and names the API, and there is no fallback path that loads React instead.
          </p>
          <ButtonLink className="mt-6" href="/docs/reference/react-compatibility" variant="outline">
            See every API and its status <ArrowIcon className="size-4" />
          </ButtonLink>
        </div>
        <div className="self-start overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
          <div className="border-b border-white/10 px-5 py-2.5 font-mono text-xs text-zinc-500">
            build output
          </div>
          <pre className="p-5 font-mono text-[13px] leading-6 whitespace-pre-wrap text-zinc-300">
            {rejectionOutput.map((line) => (
              <span className="block pb-3 last:pb-0" key={line}>
                {line}
              </span>
            ))}
          </pre>
        </div>
      </div>
    </section>
  )
}

type ExampleKey = 'branches' | 'counter' | 'form' | 'list'

const EXAMPLES: readonly { readonly key: ExampleKey; readonly label: string }[] = [
  { key: 'counter', label: 'Counter' },
  { key: 'form', label: 'Form' },
  { key: 'list', label: 'Keyed list' },
  { key: 'branches', label: 'Branches' },
]

function Examples({ data }: { readonly data: LandingData }) {
  const [tab, setTab] = useState<ExampleKey>('counter')

  return (
    <section
      aria-label="Live compiled examples"
      className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-20 sm:pb-24"
    >
      <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
        Four things, running here
      </h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Every example below is ordinary React, compiled by Vidact and mounted into this page.
      </p>
      <div className="mt-8 flex gap-1 border-b" role="tablist">
        {EXAMPLES.map((example) => (
          <TabButton
            active={tab === example.key}
            key={example.key}
            label={example.label}
            onSelect={() => setTab(example.key)}
          />
        ))}
      </div>
      <div className="mt-6">
        <ExamplePanel data={data} tab={tab} />
      </div>
    </section>
  )
}

function TabButton({
  active,
  label,
  onSelect,
}: {
  readonly active: boolean
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <button
      aria-selected={active}
      className={
        active
          ? '-mb-px border-b-2 border-foreground px-3 py-2 text-sm font-medium'
          : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground'
      }
      onClick={onSelect}
      role="tab"
      type="button"
    >
      {label}
    </button>
  )
}

function ExamplePanel({ data, tab }: { readonly data: LandingData; readonly tab: ExampleKey }) {
  switch (tab) {
    case 'form':
      return (
        <ExampleWindow
          caption="Handlers receive the native event, so event.target.value works with no cast."
          filename="Greeting.tsx"
          lines={data.form}
        >
          <GreetingDemo />
        </ExampleWindow>
      )
    case 'list':
      return (
        <ExampleWindow
          caption="Tick a row, then reverse. The row moves with its checkbox, and nothing is rebuilt."
          filename="Engines.tsx"
          lines={data.list}
        >
          <EnginesDemo />
        </ExampleWindow>
      )
    case 'branches':
      return (
        <ExampleWindow
          caption="Each branch owns its DOM. Switching disposes one and constructs the other."
          filename="Loader.tsx"
          lines={data.branch}
        >
          <BranchDemo />
        </ExampleWindow>
      )
    default:
      return (
        <ExampleWindow
          caption="Counted live by a MutationObserver watching this demo."
          filename="Counter.tsx"
          lines={data.counter}
        >
          <CounterDemo />
        </ExampleWindow>
      )
  }
}

function ExampleWindow({
  caption,
  children,
  filename,
  lines,
}: {
  readonly caption: string
  readonly children: VidactNode
  readonly filename: string
  readonly lines: readonly DocCodeLine[]
}) {
  return (
    <div className="grid overflow-hidden rounded-xl border lg:grid-cols-2">
      <div className="border-b lg:border-r lg:border-b-0">
        <CodePane filename={filename} lines={lines} />
      </div>
      <div className="flex flex-col bg-background">
        <div className="border-b px-5 py-2.5 font-mono text-xs text-muted-foreground">Result</div>
        <div className="grow p-6 sm:p-8">{children}</div>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">{caption}</p>
      </div>
    </div>
  )
}

function CodePane({
  filename,
  lines,
  rounded,
}: {
  readonly filename: string
  readonly lines: readonly DocCodeLine[]
  readonly rounded?: boolean
}) {
  return (
    <div
      className={
        rounded
          ? 'overflow-hidden rounded-xl border bg-zinc-950 text-zinc-50'
          : 'h-full bg-zinc-950 text-zinc-50'
      }
    >
      <div className="border-b border-white/10 px-5 py-2.5 font-mono text-xs text-zinc-400">
        {filename}
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-6">
        <code>
          {lines.map((line) => (
            <CodeLine key={line.key} line={line} />
          ))}
        </code>
      </pre>
    </div>
  )
}

function CodeLine({ line }: { readonly line: DocCodeLine }) {
  return (
    <span className="block min-h-6">
      {line.tokens.map((token) => (
        <span key={token.key} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </span>
  )
}

/** Exported for the browser proof tests. */
export function CounterDemo() {
  const [count, setCount] = useState(0)
  const [mutations, setMutations] = useState(0)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const outputRef = useRef<HTMLOutputElement | null>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    let active = true
    const observer = new MutationObserver((records) => {
      // Disposal removes the stage before effect cleanups run, so a queued
      // callback can arrive with `active` still true; skip it once detached.
      if (active && stage.isConnected) setMutations((current) => current + records.length)
    })
    observer.observe(stage, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const output = outputRef.current
    if (
      count === 0 ||
      output === null ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    output.animate(
      [
        { backgroundColor: 'color-mix(in oklab, var(--signal) 35%, transparent)' },
        { backgroundColor: 'transparent' },
      ],
      { duration: 650, easing: 'ease-out' },
    )
  }, [count])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4" ref={stageRef}>
        <Button onClick={() => setCount(count + 1)} variant="outline">
          Increment
        </Button>
        <output className="rounded px-1 font-mono text-sm" ref={outputRef}>
          Count: {count}
        </output>
      </div>
      <dl className="mt-6 grid max-w-sm grid-cols-3 gap-4 border-t pt-4">
        <Stat label="Component calls" live={false} value="1" />
        <Stat label="DOM mutations" live={true} value={String(mutations)} />
        <Stat label="Tree diffs" live={false} value="0" />
      </dl>
    </div>
  )
}

function Stat({
  label,
  live,
  value,
}: {
  readonly label: string
  readonly live: boolean
  readonly value: string
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={live ? 'text-signal mt-1 font-mono text-lg' : 'mt-1 font-mono text-lg'}
        data-live={live ? '' : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

function GreetingDemo() {
  const [name, setName] = useState('')

  return (
    <form className="flex max-w-sm flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
      <input
        className="h-9 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        placeholder="Your name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p className="text-sm">Hi, {name === '' ? 'stranger.' : `${name}!`}</p>
    </form>
  )
}

const ENGINES = [
  { id: 'chromium', name: 'Chromium' },
  { id: 'firefox', name: 'Firefox' },
  { id: 'webkit', name: 'WebKit' },
]

/** Exported for the browser proof tests. */
export function EnginesDemo() {
  const [engines, setEngines] = useState(ENGINES)

  return (
    <div className="max-w-sm">
      <Button onClick={() => setEngines(engines.toReversed())} size="sm" variant="outline">
        Reverse
      </Button>
      <ul className="mt-4 divide-y rounded-md border text-sm">
        {engines.map((engine) => (
          <EngineRow engine={engine} key={engine.id} />
        ))}
      </ul>
    </div>
  )
}

function EngineRow({ engine }: { readonly engine: (typeof ENGINES)[number] }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-engine={engine.id}>
      <input aria-label={`Mark ${engine.name}`} className="accent-signal size-4" type="checkbox" />
      {engine.name}
    </li>
  )
}

function BranchDemo() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const load = () => {
    setState('loading')
    timerRef.current = window.setTimeout(() => setState('ready'), 900)
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
        Loading…
      </div>
    )
  }
  if (state === 'ready') {
    return (
      <div className="flex items-center gap-4 text-sm">
        <p>Loaded.</p>
        <Button onClick={() => setState('idle')} size="sm" variant="ghost">
          Reset
        </Button>
      </div>
    )
  }

  return (
    <Button onClick={load} variant="outline">
      Load data
    </Button>
  )
}

export const Route = defineFileRoute({ loader, component: HomeRoute })
