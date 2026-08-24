import { useEffect, useState } from 'react'

import CompilerPost from './content/blog/compiler-not-runtime.mdx'
import GettingStarted from './content/getting-started.mdx'
import MentalModel from './content/mental-model.mdx'

// Design direction: an editorial compiler notebook with warm paper, ink, marginalia, and real code.
// Copy stays literal and technical; visual proof replaces invented testimonials or vanity metrics.
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
      {path === '/examples' ? <ExamplesPage /> : null}
      {path === '/blog' ? <BlogPage onNavigate={navigate} /> : null}
      {path === '/blog/compiler-not-runtime' ? <BlogArticle onNavigate={navigate} /> : null}
      <SiteFooter onNavigate={navigate} />
    </div>
  )
}

function SiteHeader({ path, onNavigate }: { path: string; onNavigate: Navigate }) {
  return (
    <header className="sticky top-0 z-50 border-b border-ink/20 bg-canvas/94 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <a className="group flex items-center gap-3" href="/" onClick={onNavigate}>
          <span className="brand-mark">V</span>
          <span className="font-display text-xl font-semibold tracking-[-0.03em]">Vidact</span>
          <span className="hidden border-l border-ink/20 pl-3 font-mono text-[9px] uppercase tracking-[0.16em] text-muted sm:inline">
            compiler project
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
            className="ml-3 hidden border-b border-ink pb-0.5 font-mono text-[11px] uppercase tracking-[0.08em] transition hover:border-accent sm:inline-flex"
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
          ? 'border-b-2 border-ink px-3 py-2 text-ink'
          : 'border-b-2 border-transparent px-3 py-2 text-muted transition hover:border-ink/25 hover:text-ink'
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
      <section className="relative overflow-hidden border-b border-ink/20">
        <div className="hero-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-16 px-5 py-16 lg:grid-cols-[1.12fr_0.88fr] lg:px-8 lg:py-24">
          <div>
            <p className="mb-8 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              Rust compiler · React-shaped TSX · Experimental
            </p>
            <h1 className="font-display max-w-4xl text-[clamp(4.2rem,9.5vw,8.8rem)] font-medium leading-[0.78] tracking-[-0.065em]">
              Your component runs once.
              <span className="mt-3 block font-normal italic">State updates the DOM.</span>
            </h1>
            <p className="mt-10 max-w-xl border-l-2 border-accent pl-5 text-lg leading-8 text-muted sm:text-xl">
              Vidact compiles supported React-shaped components into DOM construction and
              source-specific updates. A setter changes the nodes that read that source. It does not
              call the component again or diff a virtual tree.
            </p>
            <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:flex-wrap sm:items-center">
              <a className="button-primary" href="/docs" onClick={onNavigate}>
                Build the counter <span>→</span>
              </a>
              <a className="text-link" href="https://github.com/mohebifar/vidact">
                Inspect the compiler source ↗
              </a>
            </div>
          </div>

          <figure className="relative mx-auto w-full max-w-xl border-t-4 border-ink pt-3 lg:mt-16">
            <figcaption className="mb-3 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              <span>Input / Counter.tsx</span>
              <span>01</span>
            </figcaption>
            <div className="code-window">
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
            <div className="compiler-note">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Emitted relationship
              </span>
              <p className="mt-2 font-mono text-sm">
                state:count <span className="text-muted">→</span> button.firstChild.data
              </p>
            </div>
          </figure>
        </div>
      </section>

      <section className="border-b border-ink/20 bg-ink text-white">
        <div className="mx-auto grid max-w-7xl divide-y divide-white/15 px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:px-8">
          <ProofPoint label="Compiler input" value="React-shaped TSX" />
          <ProofPoint label="Runtime work" value="Static source masks" />
          <ProofPoint label="Tested in" value="Chromium · Firefox · WebKit" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.42fr_1fr]">
          <div>
            <p className="eyebrow">Not React with a smaller runtime</p>
            <h2 className="font-display mt-5 text-5xl font-medium leading-[0.9] tracking-[-0.045em] sm:text-6xl">
              The difference is when the work gets decided.
            </h2>
            <p className="mt-6 max-w-sm leading-7 text-muted">
              React and Preact compare render output at runtime. Solid connects signals to
              computations as the app runs. Svelte compiles its own component language and uses
              generated reactive effects. Vidact emits ordered DOM updaters from React-shaped TSX.
            </p>
          </div>
          <div className="overflow-x-auto border-t-2 border-ink">
            <table className="comparison-table w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr>
                  <th>System</th>
                  <th>You write</th>
                  <th>How updates connect</th>
                  <th>Browser runs</th>
                </tr>
              </thead>
              <tbody>
                <ComparisonRow
                  system="React"
                  authoring="Components + JSX"
                  decision="Render output at runtime"
                  browser="Render and commit"
                />
                <ComparisonRow
                  system="Preact"
                  authoring="React-like JSX"
                  decision="VNode tree at runtime"
                  browser="Diff and commit"
                />
                <ComparisonRow
                  system="Solid"
                  authoring="JSX + signals"
                  decision="Signal subscriptions"
                  browser="Subscribed computations"
                />
                <ComparisonRow
                  system="Svelte"
                  authoring="Svelte + runes"
                  decision="Compiler + runtime signals"
                  browser="Generated reactive effects"
                />
                <ComparisonRow
                  system="Vidact"
                  authoring="React-shaped TSX"
                  decision="Compiler source masks"
                  browser="Matching DOM updaters"
                  highlight
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-y border-ink/20 bg-paper-dark">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
          <div className="grid gap-8 border-b border-ink/20 pb-12 lg:grid-cols-[0.42fr_1fr]">
            <p className="eyebrow">One state write, end to end</p>
            <h2 className="font-display text-5xl font-medium leading-[0.92] tracking-[-0.045em] sm:text-6xl">
              The compiler does the bookkeeping.
            </h2>
          </div>
          <ol className="divide-y divide-ink/20">
            <ProcessRow
              number="01"
              title="Create the owned DOM"
              body="The component runs once to create elements, text nodes, listeners, and the dynamic ranges that it owns."
            />
            <ProcessRow
              number="02"
              title="Record every read"
              body="The compiler connects state and props to derived values and DOM bindings. Each connection becomes a bit in an updater's read mask."
            />
            <ProcessRow
              number="03"
              title="Run the matching updater"
              body="setCount marks count dirty. During the next batch, the runtime runs only the updaters whose masks read count."
            />
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="eyebrow">How we keep the claim honest</p>
            <h2 className="font-display mt-5 text-5xl font-medium leading-[0.92] tracking-[-0.045em] sm:text-6xl">
              Do not take "surgical" on faith.
            </h2>
          </div>
          <div className="grid gap-px bg-ink/20 sm:grid-cols-2">
            <EvidenceItem
              number="A"
              title="Record every mutation"
              body="MutationObserver records what changed. A test fails if an update reaches a node outside its allowed range."
            />
            <EvidenceItem
              number="B"
              title="Keep the same nodes"
              body="Tests hold DOM references before an update. Untouched elements must be the same objects afterward."
            />
            <EvidenceItem
              number="C"
              title="Use real browser engines"
              body="Tested in Chromium, Firefox, and WebKit. The corpus does not rely on a simulated DOM."
            />
            <EvidenceItem
              number="D"
              title="Fail where the source fails"
              body="Unsupported syntax gets a source-located compiler error. Vidact does not switch to a fallback renderer."
            />
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-6 border-t border-ink/20 pt-6 font-mono text-[11px] uppercase tracking-[0.1em]">
          <a className="text-link" href="/examples" onClick={onNavigate}>
            Open the examples →
          </a>
          <a
            className="text-link"
            href="https://github.com/mohebifar/vidact/tree/main/tests/browser"
          >
            Read the browser corpus ↗
          </a>
        </div>
      </section>

      <section className="border-t border-ink/20">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[0.42fr_1fr] lg:px-8 lg:py-28">
          <div>
            <p className="eyebrow">The awkward questions</p>
            <h2 className="font-display mt-5 text-5xl font-medium tracking-[-0.045em]">
              What Vidact does not hide
            </h2>
          </div>
          <div className="border-t-2 border-ink">
            <FaqItem
              question="Is Vidact React?"
              answer="No. Vidact accepts a defined React-shaped subset and provides compatible authoring types. The Rust React Compiler fork supplies analysis. Vidact owns the updater IR, code generation, and runtime."
            />
            <FaqItem
              question="Why not use Solid or Svelte?"
              answer="Use them if their authoring models fit your project today. Vidact is testing a narrower idea: React-shaped components can compile into direct DOM programs without component rerenders or runtime subscription discovery."
            />
            <FaqItem
              question="What happens when syntax is unsupported?"
              answer="Compilation stops with a source-located error. Vidact has no uncompiled component replay or fallback renderer behind the generated output."
            />
            <FaqItem
              question="Does Vidact have a runtime?"
              answer="Yes. The runtime stores state, batches writes, owns dynamic DOM ranges, and runs the compiled updater plan. It does not reconcile virtual trees or discover subscriptions."
            />
            <FaqItem
              question="Is it ready for production?"
              answer="No. Vidact is experimental. Use the examples and browser corpus to evaluate the model, find unsupported patterns, and contribute compiler cases."
            />
          </div>
        </div>
      </section>

      <section className="bg-accent">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:px-8 lg:py-20">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em]">
              The quickest useful test
            </p>
            <h2 className="font-display mt-5 max-w-3xl text-5xl font-medium leading-[0.88] tracking-[-0.05em] sm:text-7xl">
              Run TodoMVC with DevTools open.
            </h2>
          </div>
          <div>
            <p className="mb-6 max-w-md leading-7 text-ink/75">
              Add, edit, filter, and delete a row. The browser tests verify that untouched rows keep
              the same DOM nodes.
            </p>
            <pre className="border-l-2 border-ink pl-5 font-mono text-sm leading-7">
              <code>pnpm dev:todomvc</code>
            </pre>
            <a
              className="mt-7 inline-flex border-b-2 border-ink pb-1 font-semibold"
              href="/docs"
              onClick={onNavigate}
            >
              Follow the quick start →
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}

function ProofPoint({ value, label }: { value: string; label: string }) {
  return (
    <div className="py-7 sm:px-6 sm:py-9 first:sm:pl-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/45">{label}</p>
      <p className="mt-2 text-base text-white sm:text-lg">{value}</p>
    </div>
  )
}

function ComparisonRow({
  system,
  authoring,
  decision,
  browser,
  highlight = false,
}: {
  system: string
  authoring: string
  decision: string
  browser: string
  highlight?: boolean
}) {
  return (
    <tr className={highlight ? 'bg-accent' : ''}>
      <th>{system}</th>
      <td>{authoring}</td>
      <td>{decision}</td>
      <td>{browser}</td>
    </tr>
  )
}

function ProcessRow({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <li className="grid gap-4 py-8 sm:grid-cols-[80px_0.72fr_1fr] sm:items-baseline">
      <span className="font-mono text-xs text-muted">{number}</span>
      <h3 className="font-display text-3xl font-medium tracking-[-0.025em]">{title}</h3>
      <p className="leading-7 text-muted">{body}</p>
    </li>
  )
}

function EvidenceItem({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <article className="bg-canvas p-6 sm:p-8">
      <p className="font-mono text-xs text-muted">{number}</p>
      <h3 className="font-display mt-10 text-3xl font-medium tracking-[-0.03em]">{title}</h3>
      <p className="mt-4 leading-7 text-muted">{body}</p>
    </article>
  )
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="faq-item border-b border-ink/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-lg font-semibold">
        {question}
        <span aria-hidden="true" className="faq-plus font-mono text-2xl font-normal">
          +
        </span>
      </summary>
      <p className="max-w-3xl pb-7 pr-12 leading-7 text-muted">{answer}</p>
    </details>
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
            href="https://github.com/mohebifar/vidact/tree/main/docs/migration"
          >
            React migration ↗
          </a>
          <a
            className="docs-link whitespace-nowrap"
            href="https://github.com/mohebifar/vidact/tree/main/docs/architecture"
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
              <a href="#sources">State sources</a>
              <a href="#updaters">Read masks</a>
              <a href="#identity">DOM identity</a>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-muted">
              <a href="#install">Install packages</a>
              <a href="#configure">Configure Vite</a>
              <a href="#component">Write the counter</a>
              <a href="#mount">Mount the root</a>
              <a href="#verify">Check the update</a>
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

function ExamplesPage() {
  return (
    <main>
      <section className="border-b border-ink/10">
        <div className="mx-auto max-w-7xl px-5 py-18 lg:px-8 lg:py-24">
          <p className="eyebrow">Runnable compiler cases</p>
          <h1 className="font-display mt-6 max-w-5xl text-5xl font-medium leading-[0.9] tracking-[-0.055em] sm:text-7xl lg:text-8xl">
            Run the cases that are hard to fake.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted">
            These are not component galleries. Each app exercises a compiler contract that can fail
            in the DOM: keyed identity, controlled input state, hydration, streaming, or hot
            replacement.
          </p>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-7 px-5 py-16 lg:grid-cols-2 lg:px-8 lg:py-24">
        <ExampleCard
          kind="todo"
          title="TodoMVC"
          number="01"
          description="Add, edit, filter, reorder, and delete todos. The tests keep references to untouched rows and verify that each update preserves them."
          href="https://github.com/mohebifar/vidact/tree/main/examples/todomvc"
        />
        <ExampleCard
          kind="shop"
          title="Async shop"
          number="02"
          description="Stream the product page, hydrate it, change the cart, and replace code during development. The example checks ownership and cleanup across every step."
          href="https://github.com/mohebifar/vidact/tree/main/examples/shop"
        />
        <article className="rounded-3xl border border-dashed border-ink/25 p-8 lg:col-span-2">
          <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">03 · This site</p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">
                Vidact + Tailwind + MDX
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-muted">
                You are looking at the third example. Its MDX stays as JSX long enough for the
                Vidact Vite plugin to compile it. Tailwind handles the CSS.
              </p>
            </div>
            <a
              className="button-secondary shrink-0"
              href="https://github.com/mohebifar/vidact/tree/main/examples/docs"
            >
              Browse this site's source ↗
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
        <h2 className="font-display mt-4 text-3xl font-semibold tracking-[-0.035em]">{title}</h2>
        <p className="mt-4 leading-7 text-muted">{description}</p>
        <a className="mt-6 inline-flex font-bold" href={href}>
          Open the source ↗
        </a>
      </div>
    </article>
  )
}

function BlogPage({ onNavigate }: { onNavigate: Navigate }) {
  return (
    <main className="mx-auto max-w-7xl px-5 py-18 lg:px-8 lg:py-24">
      <p className="eyebrow">Compiler notes</p>
      <h1 className="font-display mt-6 max-w-5xl text-6xl font-medium leading-[0.9] tracking-[-0.055em] sm:text-8xl">
        What Vidact learns before your code reaches the browser
      </h1>
      <p className="mt-8 max-w-2xl text-lg leading-8 text-muted">
        Short essays about code generation, DOM ownership, and the React behaviors that become
        explicit when component rerenders disappear.
      </p>
      <div className="mt-16 grid gap-7 lg:grid-cols-[1.35fr_0.65fr]">
        <a
          className="group rounded-3xl bg-ink p-8 text-white sm:p-10"
          href="/blog/compiler-not-runtime"
          onClick={onNavigate}
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
            August 24, 2026 · Engineering
          </p>
          <h2 className="font-display mt-20 max-w-2xl text-4xl font-medium leading-[0.95] tracking-[-0.04em] sm:text-6xl">
            Why Vidact puts reactivity in the compiler
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/60">
            A setter names what changed. The compiler can name every reader before the app runs.
          </p>
          <span className="mt-10 inline-flex font-bold transition group-hover:translate-x-1">
            Read article →
          </span>
        </a>
        <aside className="border-t-2 border-ink pt-5">
          <p className="eyebrow">Read next in the repository</p>
          <p className="mt-5 leading-7 text-muted">
            Architecture records hold the decisions that need more detail than a blog post.
          </p>
          <a
            className="mt-8 block border-t border-ink/20 py-5 font-semibold hover:bg-accent"
            href="https://github.com/mohebifar/vidact/blob/main/docs/architecture/react-analysis-boundary.md"
          >
            React analysis boundary ↗
          </a>
          <a
            className="block border-y border-ink/20 py-5 font-semibold hover:bg-accent"
            href="https://github.com/mohebifar/vidact/blob/main/docs/architecture/owner-safe-root-replacement-and-hmr.md"
          >
            Root replacement and HMR ↗
          </a>
        </aside>
      </div>
    </main>
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
    <footer className="bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.6fr_0.6fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="brand-mark brand-mark-small">V</span>
            <span className="font-display text-2xl">Vidact</span>
          </div>
          <p className="mt-5 max-w-md text-sm leading-6 text-white/55">
            Vidact is an experimental compiler, not a production React replacement. Use it to
            inspect direct DOM output and contribute compiler cases.
          </p>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/35">Read</p>
          <a className="block hover:text-accent" href="/docs" onClick={onNavigate}>
            Documentation
          </a>
          <a className="block hover:text-accent" href="/examples" onClick={onNavigate}>
            Examples
          </a>
          <a className="block hover:text-accent" href="/blog" onClick={onNavigate}>
            Notes
          </a>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/35">Project</p>
          <a className="block hover:text-accent" href="https://github.com/mohebifar/vidact">
            GitHub ↗
          </a>
          <a
            className="block hover:text-accent"
            href="https://github.com/mohebifar/vidact/blob/main/LICENSE"
          >
            License ↗
          </a>
        </div>
      </div>
      <div className="mx-auto max-w-7xl border-t border-white/15 px-5 py-5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35 lg:px-8">
        The source, tests, and unsupported cases are public.
      </div>
    </footer>
  )
}

function currentPath(): string {
  return window.location.pathname.replace(/\/$/, '') || '/'
}
