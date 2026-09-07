import type { VidactNode } from '@vidact/react-types'
import { defineFileRoute, Link, type RouteComponentProps } from '@vidact/start'
import { useEffect, useRef, useState } from 'react'

import { SearchButton } from '@/components/docs-search.tsx'
import { ArrowIcon } from '@/components/icons.tsx'
import { Button, ButtonLink } from '@/components/ui/button.tsx'
import type { DocCodeLine } from '@/lib/docs-types.ts'
import { mountHeroLogo } from '@/lib/hero-logo-mount.ts'
import { loadLandingData } from '@/lib/landing-loader.ts'

const loader = () => loadLandingData()

type LandingData = Awaited<ReturnType<typeof loader>>
type LandingProps = RouteComponentProps<LandingData>

export function HomeRoute({ loaderData }: LandingProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <div className="bg-zinc-950 text-white">
        <section className="relative overflow-hidden">
          <HeroLogo />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-linear-to-r from-zinc-950 via-zinc-950/45 via-30% to-transparent to-65%"
          />
          <div className="relative mx-auto max-w-6xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-24">
            <h1 className="font-display max-w-3xl text-5xl font-bold tracking-tight text-balance sm:text-7xl">
              Write React. Ship direct DOM.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">
              Vidact compiles React-style function components and hooks into direct DOM operations.
              Components run once when they mount.
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
              In beta.{' '}
              <Link
                className="text-zinc-300 underline underline-offset-4"
                href="/docs/reference/react-compatibility"
              >
                Check React compatibility
              </Link>
            </p>
          </div>
        </section>
      </div>

      <CompilerModel />

      <CompilerDemo data={loaderData} />

      <Examples data={loaderData} />

      <Origin />

      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-10 sm:py-16 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Build full-stack apps
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Vidact Start applies the same compiler model to SSR and hydration, then adds file
              routes, loaders, and client navigation. This documentation site runs on it.
            </p>
            <Link
              className="decoration-muted-foreground/60 mt-6 inline-flex items-center gap-2 font-medium underline underline-offset-4 hover:decoration-current"
              href="/docs/start/getting-started"
            >
              Read the Start guide <ArrowIcon className="size-4" />
            </Link>
          </div>
          <CodePane
            filename="src/routes/products/$productId.tsx"
            lines={loaderData.route}
            rounded
          />
        </div>
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
          <SearchButton />
          <Link className="hover:text-white" href="/docs">
            Docs
          </Link>
          <Link className="hidden hover:text-white sm:inline" href="/docs/learn/thinking-in-vidact">
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

const REACT_PIPELINE = [
  'State changes',
  'Run component',
  'Create element tree',
  'Reconcile',
  'Update DOM',
] as const
const VIDACT_PIPELINE = ['State changes', 'Run selected updater', 'Update DOM'] as const

function CompilerModel() {
  return (
    <section className="border-b">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-10 sm:py-16 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="font-mono text-xs text-muted-foreground">What changes</p>
          <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            State goes straight to the DOM
          </h2>
          <p className="mt-5 leading-7 text-muted-foreground">
            The compiler works out which expressions depend on each value and writes an updater for
            them. A state change runs that updater instead of running the component again.
          </p>
          <p className="mt-5 leading-7 text-muted-foreground">
            The browser runs Vidact's small runtime. React, the Virtual DOM, the reconciler, and
            runtime dependency tracking <strong>stay out of the bundle</strong>.
          </p>
        </div>
        <div className="space-y-5 self-center">
          <Pipeline label="React runtime" steps={REACT_PIPELINE} />
          <Pipeline label="Vidact" signal steps={VIDACT_PIPELINE} />
        </div>
      </div>
    </section>
  )
}

function Pipeline({
  label,
  signal = false,
  steps,
}: {
  readonly label: string
  readonly signal?: boolean
  readonly steps: readonly string[]
}) {
  return (
    <div
      className={
        signal ? 'border-signal/40 rounded-xl border bg-signal/5 p-5' : 'rounded-xl border p-5'
      }
    >
      <p
        className={
          signal ? 'text-signal font-mono text-xs' : 'font-mono text-xs text-muted-foreground'
        }
      >
        {label}
      </p>
      <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {steps.map((step, index) => (
          <li className="flex items-center gap-2" key={step}>
            <span className="rounded-md bg-muted px-2.5 py-1.5 font-medium">{step}</span>
            {index === steps.length - 1 ? null : (
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

type CompilerView = 'actual' | 'readable'

const COMPILER_VIEWS: readonly { readonly key: CompilerView; readonly label: string }[] = [
  { key: 'readable', label: 'Readable output' },
  { key: 'actual', label: 'Actual output' },
]

/** Exported for the compiled browser interaction tests. */
export function CompilerDemo({ data }: { readonly data: LandingData }) {
  const [view, setView] = useState<CompilerView>('readable')

  return (
    <section className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
      <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        What the compiler writes
      </h2>
      <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
        Compare the component with a readable expansion of its DOM operations, or switch to the
        exact compiler output.
      </p>
      <div className="mt-8 grid overflow-hidden rounded-xl border lg:grid-cols-2">
        <div
          className="min-w-0 border-b bg-zinc-950 lg:border-r lg:border-b-0"
          id="compiler-source"
        >
          <div className="border-b px-5 h-12 font-mono text-xs text-zinc-400 items-center flex">
            Source
          </div>
          <CompilerCode className="h-155" lines={data.counter} note="The component you write." />
        </div>
        <div className="flex min-w-0 flex-col border-b bg-zinc-950 lg:border-b-0">
          <div
            aria-label="Generated output view"
            className="flex gap-1 overflow-x-auto border-b px-3 h-12"
            role="tablist"
          >
            {COMPILER_VIEWS.map((item) => (
              <button
                aria-controls="compiler-output"
                aria-selected={view === item.key}
                className={
                  view === item.key
                    ? '-mb-px border-b-2 border-white px-3 py-2 text-sm font-medium text-white'
                    : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-zinc-400 hover:text-white'
                }
                id={`compiler-tab-${item.key}`}
                key={item.key}
                onClick={() => setView(item.key)}
                role="tab"
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            aria-label="Generated compiler output"
            className="grow"
            id="compiler-output"
            role="tabpanel"
          >
            {view === 'readable' ? (
              <CompilerCode
                lines={data.readable}
                className="h-155"
                note="Runtime scheduling and cleanup are omitted for readability."
              />
            ) : null}
            {view === 'actual' ? (
              <CompilerCode
                className="h-155"
                lines={data.compiled}
                note="Exact output from @vidact/compiler."
              />
            ) : null}
          </div>
        </div>
        <div className="col-span-full flex flex-col border-t bg-background">
          <div className="border-b px-5 py-2.5 font-mono text-xs text-muted-foreground">
            Result preview
          </div>
          <div className="grow p-6 sm:p-8">
            <CounterDemo />
          </div>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Increment updates the existing text node.
          </p>
        </div>
      </div>
    </section>
  )
}

function CompilerCode({
  filename,
  lines,
  note,
  className,
}: {
  readonly filename?: string
  readonly lines: readonly DocCodeLine[]
  readonly note: string
  readonly className?: string
}) {
  return <CodePane className={className} filename={filename} footer={note} lines={lines} />
}

function Origin() {
  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-end lg:gap-16">
          <div>
            <p className="font-mono text-xs text-muted-foreground">Why now</p>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              I came back to a six-year-old experiment
            </h2>
          </div>
          <p className="leading-7 text-muted-foreground">
            I started Vidact in 2020, then put it aside. Work on{' '}
            <a className="underline underline-offset-4" href="https://grep.codemod.com">
              grep.codemod.com
            </a>{' '}
            gave me a reason to rebuild it with React Compiler's analysis doing much of the heavy
            lifting.
          </p>
        </div>
        <div className="mt-10 grid gap-5 border-t pt-8 lg:grid-cols-2 lg:gap-16">
          <h3 className="font-display text-xl font-semibold">What Vidact reuses</h3>
          <p className="leading-7 text-muted-foreground">
            The compiler is written in Rust and uses React Compiler's analysis infrastructure for
            AST, scope, HIR, CFG, SSA, and dependency information. Vidact has its own IR, DOM code
            generator, and runtime.
          </p>
        </div>
      </div>
    </section>
  )
}

function Limits() {
  return (
    <section>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-8 px-6 py-16 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Unsupported React stays a compile error
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Unsupported code fails at build time. Vidact never responds by shipping React or
            switching to a slower renderer, which makes it a deliberate subset of React today.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Found a React pattern that should compile?{' '}
            <a
              className="text-foreground underline underline-offset-4"
              href="https://github.com/mohebifar/vidact/issues"
            >
              Open an issue.
            </a>
          </p>
        </div>
        <ButtonLink href="/docs/reference/react-compatibility" variant="outline">
          See supported APIs <ArrowIcon className="size-4" />
        </ButtonLink>
      </div>
    </section>
  )
}

type ExampleKey = 'branches' | 'form' | 'list'

const EXAMPLES: readonly { readonly key: ExampleKey; readonly label: string }[] = [
  { key: 'form', label: 'Form' },
  { key: 'list', label: 'Keyed list' },
  { key: 'branches', label: 'Branches' },
]

function Examples({ data }: { readonly data: LandingData }) {
  const [tab, setTab] = useState<ExampleKey>('form')

  return (
    <section
      aria-label="Live compiled examples"
      className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-20 sm:pb-24"
    >
      <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
        More compiled behavior
      </h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Forms, keyed lists, and conditional branches use the same update model.
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
    case 'list':
      return (
        <ExampleWindow
          caption="Check a row, then reverse. The checked row moves with its DOM node."
          filename="Engines.tsx"
          lines={data.list}
        >
          <EnginesDemo />
        </ExampleWindow>
      )
    case 'branches':
      return (
        <ExampleWindow
          caption="Changing state removes one branch and inserts the next."
          filename="Loader.tsx"
          lines={data.branch}
        >
          <BranchDemo />
        </ExampleWindow>
      )
    default:
      return (
        <ExampleWindow
          caption="Typing updates the existing greeting."
          filename="Greeting.tsx"
          lines={data.form}
        >
          <GreetingDemo />
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
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border lg:grid-cols-2">
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
  footer,
  lines,
  rounded,
  className,
}: {
  readonly filename: string | undefined
  readonly footer?: string
  readonly lines: readonly DocCodeLine[]
  readonly rounded?: boolean
  readonly className?: string | undefined
}) {
  return (
    <div
      className={
        rounded
          ? 'overflow-hidden rounded-xl border bg-zinc-950 text-zinc-50'
          : footer
            ? 'grid h-full grid-rows-[auto_1fr_auto] bg-zinc-950 text-zinc-50'
            : 'h-full bg-zinc-950 text-zinc-50'
      }
    >
      {filename && (
        <div className="border-b border-white/10 px-5 py-2.5 font-mono text-xs text-zinc-400">
          {filename}
        </div>
      )}
      <pre className={`overflow-x-auto p-5 text-[13px] leading-6 ${className ?? ''}`}>
        <code>
          {lines.map((line) => (
            <CodeLine key={line.key} line={line} />
          ))}
        </code>
      </pre>
      {footer ? (
        <p className="border-t border-white/10 px-5 py-3 text-xs text-zinc-400">{footer}</p>
      ) : null}
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
      <dl className="mt-6 grid max-w-md grid-cols-3 gap-4 border-t pt-4">
        <Stat label="Component runs" live={false} value="1" />
        <Stat label="DOM mutations" live={true} value={String(mutations)} />
        <Stat label="Production bundle" live={false} value="8.1 kB" />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Gzipped, including the runtime.</p>
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
        aria-label="Your name"
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
