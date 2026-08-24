import { useEffect, useState } from 'react'

import CompilerPost from './content/blog/compiler-not-runtime.mdx'
import GettingStarted from './content/getting-started.mdx'
import MentalModel from './content/mental-model.mdx'

type Navigate = (event: MouseEvent) => void

export function App() {
  const [path, setPath] = useState(currentPath())

  useEffect(() => {
    const syncPath = () => setPath(currentPath())
    window.addEventListener('popstate', syncPath)
    return () => window.removeEventListener('popstate', syncPath)
  }, [])

  function navigate(event: MouseEvent): void {
    const anchor = event.currentTarget as HTMLAnchorElement
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const nextPath = new URL(anchor.href).pathname
    if (nextPath === path) return
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteHeader path={path} onNavigate={navigate} />
      {path === '/' ? <LandingPage onNavigate={navigate} /> : null}
      {path === '/docs' ? (
        <DocsPage path={path} onNavigate={navigate} content="getting-started" />
      ) : null}
      {path === '/docs/mental-model' ? (
        <DocsPage path={path} onNavigate={navigate} content="mental-model" />
      ) : null}
      {path === '/examples' ? <ExamplesPage onNavigate={navigate} /> : null}
      {path === '/blog' ? <BlogPage onNavigate={navigate} /> : null}
      {path === '/blog/compiler-not-runtime' ? <BlogArticle onNavigate={navigate} /> : null}
      <SiteFooter onNavigate={navigate} />
    </div>
  )
}

function SiteHeader({ path, onNavigate }: { path: string; onNavigate: Navigate }) {
  return (
    <header className="sticky top-0 z-50 border-b border-ink/10 bg-canvas/90 backdrop-blur-xl">
      <div className="mx-auto flex h-17 max-w-7xl items-center justify-between px-5 lg:px-8">
        <a className="group flex items-center gap-3" href="/" onClick={onNavigate}>
          <span className="brand-mark">V</span>
          <span className="text-base font-black tracking-[-0.04em]">vidact</span>
          <span className="hidden rounded-full border border-ink/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted sm:inline">
            experimental
          </span>
        </a>
        <nav aria-label="Main navigation" className="flex items-center gap-1 text-sm font-semibold">
          <HeaderLink active={path.startsWith('/docs')} href="/docs" onNavigate={onNavigate}>
            Docs
          </HeaderLink>
          <HeaderLink active={path === '/examples'} href="/examples" onNavigate={onNavigate}>
            Examples
          </HeaderLink>
          <HeaderLink active={path.startsWith('/blog')} href="/blog" onNavigate={onNavigate}>
            Blog
          </HeaderLink>
          <a
            className="ml-2 hidden rounded-full bg-ink px-4 py-2 text-canvas transition hover:-translate-y-0.5 hover:bg-ink/85 sm:inline-flex"
            href="https://github.com/mohebifar/vidact"
          >
            GitHub ↗
          </a>
        </nav>
      </div>
    </header>
  )
}

function HeaderLink({
  active,
  href,
  onNavigate,
  children,
}: {
  active: boolean
  href: string
  onNavigate: Navigate
  children: string
}) {
  return (
    <a
      className={
        active
          ? 'rounded-full bg-ink/8 px-3 py-2 text-ink'
          : 'rounded-full px-3 py-2 text-muted transition hover:bg-ink/5 hover:text-ink'
      }
      href={href}
      onClick={onNavigate}
    >
      {children}
    </a>
  )
}

function LandingPage({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-ink/10">
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-55" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 py-18 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:py-28">
          <div className="self-center">
            <div className="mb-7 flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_0_5px_rgba(183,243,75,0.2)]" />
              React-shaped · compiler-driven
            </div>
            <h1 className="max-w-4xl text-[clamp(3.8rem,9.2vw,8.4rem)] font-black leading-[0.82] tracking-[-0.075em]">
              Render once.
              <span className="block text-stroke">Update exactly.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
              Vidact compiles familiar function components into direct DOM construction and a static
              update plan. No Virtual DOM. No runtime dependency graph. No component replay.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a className="button-primary" href="/docs" onClick={onNavigate}>
                Start building <span>→</span>
              </a>
              <a className="button-secondary" href="/docs/mental-model" onClick={onNavigate}>
                Read the mental model
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:self-center">
            <div className="code-window rotate-[-1.25deg]">
              <div className="window-bar">
                <span className="window-dot bg-[#ff6b6b]" />
                <span className="window-dot bg-[#ffd43b]" />
                <span className="window-dot bg-accent" />
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Counter.tsx
                </span>
              </div>
              <pre className="overflow-x-auto p-6 text-[13px] leading-7 sm:p-8 sm:text-sm">
                <code>
                  <span className="code-dim">import</span> {'{ useState }'}{' '}
                  <span className="code-dim">from</span>{' '}
                  <span className="code-string">'react'</span>
                  {`\n\n`}
                  <span className="code-dim">export function</span>{' '}
                  <span className="code-accent">Counter</span>() {'{'}
                  {`\n  `}
                  <span className="code-dim">const</span> [count, setCount] = useState(
                  <span className="code-number">0</span>){`\n\n  `}
                  <span className="code-dim">return</span> ({`\n    `}&lt;button onClick={'{'}()
                  =&gt; setCount(count + <span className="code-number">1</span>){'}'}&gt;
                  {`\n      `}Count: {'{'}count{'}'}
                  {`\n    `}&lt;/button&gt;{`\n  `}){`\n`}
                  {'}'}
                </code>
              </pre>
            </div>
            <div className="absolute -bottom-8 -right-2 w-[88%] rounded-2xl border border-ink/15 bg-white p-5 shadow-[0_24px_70px_rgba(13,17,23,0.16)] sm:-right-8 sm:w-[75%]">
              <div className="mb-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                <span>Compiler output</span>
                <span className="rounded-full bg-accent/30 px-2 py-1 text-ink">static</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs sm:text-sm">
                <span className="rounded-md bg-ink px-2.5 py-1.5 text-white">state:0</span>
                <span className="text-muted">→</span>
                <span className="rounded-md border border-ink/15 px-2.5 py-1.5">text binding</span>
                <span className="text-muted">→</span>
                <span className="font-bold">DOM</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-ink/10 bg-ink text-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-white/12 px-5 sm:grid-cols-4 lg:px-8">
          <Metric value="0" label="virtual trees" />
          <Metric value="0" label="runtime subscriptions" />
          <Metric value="1×" label="component construction" />
          <Metric value="DOM" label="the actual target" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
        <div className="mb-14 grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <p className="eyebrow">The difference</p>
          <h2 className="text-4xl font-black leading-[0.95] tracking-[-0.055em] sm:text-6xl">
            Same component shape.
            <br />A different execution model.
          </h2>
        </div>
        <div className="grid overflow-hidden rounded-3xl border border-ink/15 lg:grid-cols-4">
          <CompareCard
            name="React"
            note="Rerender + reconcile"
            body="State schedules component work. A new element tree is compared with the previous one at runtime."
          />
          <CompareCard
            name="Preact"
            note="Smaller VDOM runtime"
            body="A compact implementation with familiar semantics, still centered on rerendering and tree diffing."
          />
          <CompareCard
            name="Solid"
            note="Runtime signal graph"
            body="Fine-grained updates without a Virtual DOM. Dependencies are tracked through signals as code runs."
          />
          <CompareCard
            name="Svelte"
            note="Compiler + own syntax"
            body="Compiler-generated updates with a framework-specific component language and reactivity model."
          />
        </div>
        <div className="mt-4 rounded-3xl bg-accent p-7 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em]">Vidact</p>
              <h3 className="mt-3 text-3xl font-black tracking-[-0.045em] sm:text-4xl">
                Static updater plan
              </h3>
            </div>
            <p className="text-lg leading-8 text-ink/75">
              React-compatible authoring is analyzed ahead of time. The browser stores values,
              batches writes, and runs compiler-selected DOM operations—without rediscovering the
              dependency graph.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-ink/10 bg-white">
        <div className="mx-auto grid max-w-7xl lg:grid-cols-2">
          <div className="border-b border-ink/10 p-7 sm:p-12 lg:border-b-0 lg:border-r">
            <p className="eyebrow">At build time</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.05em]">Vidact finds the edges.</h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
              State, props, derivations, text, properties, owned conditional ranges, and keyed lists
              become an ordered graph of static reads and writes.
            </p>
            <ol className="mt-10 space-y-4 font-mono text-sm">
              <Step number="01" text="Parse React-shaped TSX" />
              <Step number="02" text="Lower analysis into updater IR" />
              <Step number="03" text="Emit DOM construction + masks" />
            </ol>
          </div>
          <div className="p-7 sm:p-12">
            <p className="eyebrow">In the browser</p>
            <h2 className="mt-5 text-4xl font-black tracking-[-0.05em]">
              The runtime stays boring.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
              A state write marks a source dirty. Only updaters whose masks intersect that source
              run, in the order already proven by the compiler.
            </p>
            <ol className="mt-10 space-y-4 font-mono text-sm">
              <Step number="01" text="Write an ordinary value" />
              <Step number="02" text="Select affected static masks" />
              <Step number="03" text="Mutate the existing DOM" />
            </ol>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
        <div className="rounded-[2rem] bg-ink px-6 py-14 text-white sm:px-12 lg:px-16 lg:py-18">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-accent">
                MDX, compiled by Vidact
              </p>
              <h2 className="mt-5 text-4xl font-black leading-[0.95] tracking-[-0.055em] sm:text-6xl">
                These docs are the example.
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/60">
                Markdown content becomes JSX first, then passes through the same Vidact compiler as
                the application shell. The page you are reading proves the pipeline works.
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/5 p-5 font-mono text-sm leading-7 text-white/75">
              <p>
                <span className="text-accent">01</span> MDX → preserved JSX
              </p>
              <p>
                <span className="text-accent">02</span> JSX → Vidact updater IR
              </p>
              <p>
                <span className="text-accent">03</span> IR → direct DOM program
              </p>
              <a
                className="mt-7 inline-flex font-sans font-bold text-white hover:text-accent"
                href="/docs"
                onClick={onNavigate}
              >
                Read the MDX docs →
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="py-8 text-center sm:py-10">
      <div className="text-3xl font-black tracking-[-0.04em] text-accent sm:text-4xl">{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/45 sm:text-[10px]">
        {label}
      </div>
    </div>
  )
}

function CompareCard({ name, note, body }: { name: string; note: string; body: string }) {
  return (
    <article className="border-b border-ink/15 p-6 last:border-b-0 lg:min-h-72 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-2xl font-black tracking-[-0.04em]">{name}</h3>
        <span className="mt-1 h-2 w-2 rounded-full bg-ink/20" />
      </div>
      <p className="mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
        {note}
      </p>
      <p className="mt-5 leading-7 text-muted">{body}</p>
    </article>
  )
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <li className="flex items-center gap-4 rounded-xl border border-ink/10 p-4">
      <span className="font-bold text-muted">{number}</span>
      <span>{text}</span>
    </li>
  )
}

function DocsPage({
  path,
  onNavigate,
  content,
}: {
  path: string
  onNavigate: Navigate
  content: 'getting-started' | 'mental-model'
}) {
  return (
    <main className="mx-auto grid max-w-7xl gap-10 px-5 py-10 lg:grid-cols-[220px_minmax(0,1fr)_170px] lg:px-8 lg:py-16">
      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
          Documentation
        </p>
        <nav
          aria-label="Documentation"
          className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1"
        >
          <DocsLink active={path === '/docs'} href="/docs" onNavigate={onNavigate}>
            Getting started
          </DocsLink>
          <DocsLink
            active={path === '/docs/mental-model'}
            href="/docs/mental-model"
            onNavigate={onNavigate}
          >
            Mental model
          </DocsLink>
          <a
            className="docs-link whitespace-nowrap"
            href="https://github.com/mohebifar/vidact/tree/master/docs/migration"
          >
            React migration ↗
          </a>
          <a
            className="docs-link whitespace-nowrap"
            href="https://github.com/mohebifar/vidact/tree/master/docs/architecture"
          >
            Architecture ↗
          </a>
        </nav>
      </aside>
      <article className="mdx-content min-w-0">
        {content === 'mental-model' ? <MentalModel /> : <GettingStarted />}
      </article>
      <aside className="hidden lg:block">
        <div className="sticky top-24 border-l border-ink/10 pl-5">
          <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
            On this page
          </p>
          {content === 'mental-model' ? (
            <div className="space-y-3 text-xs text-muted">
              <a href="#construction">Construct once</a>
              <a href="#sources">Dirty sources</a>
              <a href="#updaters">Static masks</a>
              <a href="#identity">DOM identity</a>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-muted">
              <a href="#install">Install</a>
              <a href="#configure">Configure</a>
              <a href="#component">Component</a>
              <a href="#mount">Mount</a>
            </div>
          )}
        </div>
      </aside>
    </main>
  )
}

function DocsLink({
  active,
  href,
  onNavigate,
  children,
}: {
  active: boolean
  href: string
  onNavigate: Navigate
  children: string
}) {
  return (
    <a
      className={
        active ? 'docs-link docs-link-active whitespace-nowrap' : 'docs-link whitespace-nowrap'
      }
      href={href}
      onClick={onNavigate}
    >
      {children}
    </a>
  )
}

function ExamplesPage({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <main>
      <section className="border-b border-ink/10">
        <div className="mx-auto max-w-7xl px-5 py-18 lg:px-8 lg:py-24">
          <p className="eyebrow">Example applications</p>
          <h1 className="mt-6 max-w-5xl text-5xl font-black leading-[0.9] tracking-[-0.065em] sm:text-7xl lg:text-8xl">
            See surgical updates in real interfaces.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted">
            Each app is React-shaped TSX compiled into direct DOM operations. Open the source, run
            it locally, then watch node identity stay put.
          </p>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-7 px-5 py-16 lg:grid-cols-2 lg:px-8 lg:py-24">
        <ExampleCard
          kind="todo"
          title="TodoMVC"
          number="01"
          description="Keyed array updates, filters, editing, controlled inputs, and DOM identity assertions in a familiar test bed."
          href="https://github.com/mohebifar/vidact/tree/master/examples/todomvc"
        />
        <ExampleCard
          kind="shop"
          title="Async shop"
          number="02"
          description="A product catalog with Suspense, streaming server output, hydration, cart state, and owner-safe hot replacement."
          href="https://github.com/mohebifar/vidact/tree/master/examples/shop"
        />
        <article className="rounded-3xl border border-dashed border-ink/25 p-8 lg:col-span-2">
          <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">03 · This site</p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">
                Vidact + Tailwind + MDX
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-muted">
                A multi-page documentation shell whose MDX modules preserve JSX and pass through the
                Vidact compiler.
              </p>
            </div>
            <a className="button-secondary shrink-0" href="/docs" onClick={onNavigate}>
              Open the docs →
            </a>
          </div>
        </article>
      </section>
    </main>
  )
}

function ExampleCard({
  kind,
  title,
  number,
  description,
  href,
}: {
  kind: 'todo' | 'shop'
  title: string
  number: string
  description: string
  href: string
}) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-ink/15 bg-white">
      <div
        className={
          kind === 'todo' ? 'example-preview example-todo' : 'example-preview example-shop'
        }
      >
        {kind === 'todo' ? (
          <div className="w-[82%] rounded-xl bg-white p-5 shadow-2xl">
            <p className="text-center text-3xl font-extralight text-[#b83f45]">todos</p>
            <div className="mt-4 border-t border-ink/10">
              <p className="border-b border-ink/10 py-3 text-sm">○ Study the compiler</p>
              <p className="border-b border-ink/10 py-3 text-sm">● Ship direct DOM</p>
            </div>
          </div>
        ) : (
          <div className="grid w-[88%] grid-cols-3 gap-3">
            <div className="col-span-3 flex items-center justify-between rounded-lg bg-ink p-3 text-xs text-white">
              <strong>FIELD / STORE</strong>
              <span className="text-accent">Cart · 2</span>
            </div>
            <div className="aspect-[3/4] rounded-lg bg-[#e4a853]" />
            <div className="aspect-[3/4] rounded-lg bg-[#d8d0bd]" />
            <div className="aspect-[3/4] rounded-lg bg-[#7b8a75]" />
          </div>
        )}
      </div>
      <div className="p-7">
        <div className="flex items-center justify-between">
          <p className="eyebrow">{number} · Application</p>
          <span className="transition group-hover:translate-x-1">↗</span>
        </div>
        <h2 className="mt-4 text-3xl font-black tracking-[-0.045em]">{title}</h2>
        <p className="mt-4 leading-7 text-muted">{description}</p>
        <a className="mt-6 inline-flex font-bold" href={href}>
          Browse source →
        </a>
      </div>
    </article>
  )
}

function BlogPage({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <main className="mx-auto max-w-7xl px-5 py-18 lg:px-8 lg:py-24">
      <p className="eyebrow">Dispatches from the compiler</p>
      <h1 className="mt-6 text-6xl font-black tracking-[-0.065em] sm:text-8xl">
        Notes on doing less.
      </h1>
      <div className="mt-16 grid gap-7 lg:grid-cols-[1.35fr_0.65fr]">
        <a
          className="group rounded-3xl bg-ink p-8 text-white sm:p-10"
          href="/blog/compiler-not-runtime"
          onClick={onNavigate}
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
            August 23, 2026 · Engineering
          </p>
          <h2 className="mt-20 max-w-2xl text-4xl font-black leading-[0.95] tracking-[-0.05em] sm:text-6xl">
            The compiler is the reactivity system
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/60">
            Why Vidact treats static dependency edges as the product—not an optimization.
          </p>
          <span className="mt-10 inline-flex font-bold transition group-hover:translate-x-1">
            Read article →
          </span>
        </a>
        <div className="space-y-7">
          <BlogStub title="Why there is no fallback renderer" label="Compiler contract" />
          <BlogStub title="DOM identity as a performance test" label="Testing" />
        </div>
      </div>
    </main>
  )
}

function BlogStub({ title, label }: { title: string; label: string }) {
  return (
    <article className="rounded-3xl border border-ink/15 bg-white p-7">
      <p className="eyebrow">Coming soon · {label}</p>
      <h2 className="mt-10 text-2xl font-black leading-tight tracking-[-0.04em]">{title}</h2>
      <p className="mt-4 text-sm leading-6 text-muted">
        Notes from the Rust rebuild and the contracts it made explicit.
      </p>
    </article>
  )
}

function BlogArticle({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <main className="mx-auto max-w-4xl px-5 py-12 lg:px-8 lg:py-20">
      <a
        className="mb-10 inline-flex text-sm font-bold text-muted hover:text-ink"
        href="/blog"
        onClick={onNavigate}
      >
        ← All posts
      </a>
      <article className="mdx-content">
        <CompilerPost />
      </article>
    </main>
  )
}

function SiteFooter({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <footer className="border-t border-ink/10">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-5 py-10 text-sm text-muted sm:flex-row sm:items-center lg:px-8">
        <div className="flex items-center gap-3">
          <span className="brand-mark brand-mark-small">V</span>
          <span>Vidact is an experimental React-to-Vanilla compiler.</span>
        </div>
        <div className="flex gap-5 font-semibold">
          <a href="/docs" onClick={onNavigate}>
            Docs
          </a>
          <a href="/examples" onClick={onNavigate}>
            Examples
          </a>
          <a href="https://github.com/mohebifar/vidact">GitHub ↗</a>
        </div>
      </div>
    </footer>
  )
}

function currentPath(): string {
  return window.location.pathname.replace(/\/$/, '') || '/'
}
