import { Link } from '@vidact/start'
import { useState } from 'react'

import { classes } from '@/lib/classes.ts'

import type { DocBlock as DocBlockData, LoadedDocPage } from '@/lib/docs-types.ts'

import { ArrowIcon } from './icons.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.tsx'
import { Switch } from './ui/switch.tsx'

type DocsPageProps = { readonly page: LoadedDocPage }

export function DocsPage({ page }: DocsPageProps) {
  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-6 py-12 sm:px-10 sm:py-16 xl:grid-cols-[minmax(0,1fr)_11rem]">
      <article className="min-w-0" data-testid="docs-article">
        <header className="mb-12 border-b pb-10">
          <Badge variant="outline">{page.kind}</Badge>
          <h1 className="mt-4 scroll-m-20 text-4xl font-bold tracking-tight sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            {page.description}
          </p>
        </header>

        <div className="docs-prose space-y-12">
          {page.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              <div className="mt-5 space-y-5">
                {section.blocks.map((block) => (
                  <DocBlock block={block} key={block.key} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <nav aria-label="Page navigation" className="mt-16 grid gap-4 border-t pt-8 sm:grid-cols-2">
          {page.previous === null ? (
            <span />
          ) : (
            <PageLink direction="Previous" item={page.previous} />
          )}
          {page.next === null ? <span /> : <PageLink direction="Next" item={page.next} />}
        </nav>
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-24">
          <p className="mb-3 text-xs font-semibold">On this page</p>
          <nav aria-label="Table of contents" className="space-y-2 border-l pl-4">
            {page.sections.map((section) => (
              <a
                className="block text-sm text-muted-foreground transition-colors hover:text-foreground"
                href={`#${section.id}`}
                key={section.id}
              >
                {section.title}
              </a>
            ))}
          </nav>
        </div>
      </aside>
    </div>
  )
}

function DocBlock({ block }: { readonly block: DocBlockData }) {
  if (block.type === 'paragraph') return <p>{block.text}</p>
  if (block.type === 'list') {
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  }
  if (block.type === 'steps') {
    return (
      <ol>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    )
  }
  if (block.type === 'code') {
    return <CodeBlock code={block.code} language={block.language} lines={block.lines} />
  }
  if (block.type === 'callout') {
    return (
      <aside
        className={classes(
          'rounded-xl border bg-muted/40 p-5',
          block.tone === 'warning' &&
            'border-amber-500/30 bg-amber-500/10 dark:border-amber-400/25',
        )}
      >
        <p className="font-medium text-foreground">{block.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{block.text}</p>
      </aside>
    )
  }
  if (block.type === 'table') {
    return (
      <div className="overflow-x-auto rounded-xl border">
        <table>
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell) => (
                  <td key={cell}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <ComponentPreview variant={block.variant} />
}

function CodeBlock({
  code,
  language,
  lines,
}: {
  readonly code: string
  readonly language: string
  readonly lines: Extract<DocBlockData, { type: 'code' }>['lines']
}) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <div className="not-prose overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-50">
      <div className="flex items-center border-b border-white/10 px-4 py-2 text-xs text-zinc-400">
        <span>{language}</span>
        <button
          className="ml-auto rounded px-2 py-1 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          onClick={copy}
          type="button"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-6" data-language={language}>
        <code>
          {lines.map((line) => (
            <span className="block min-h-6" key={line.key}>
              {line.tokens.map((token) => (
                <span key={token.key} style={{ color: token.color }}>
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function ComponentPreview({
  variant,
}: {
  readonly variant: 'buttons' | 'cards' | 'counter' | 'switch'
}) {
  if (variant === 'buttons') {
    return (
      <div className="component-preview flex flex-wrap items-center gap-3">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </div>
    )
  }
  if (variant === 'cards') {
    return (
      <div className="component-preview">
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Compile the component</CardTitle>
            <CardDescription>Keep ownership local and dependencies explicit.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Vidact native</Badge>
          </CardContent>
        </Card>
      </div>
    )
  }
  if (variant === 'counter') {
    return (
      <div className="component-preview">
        <CompiledCounter />
      </div>
    )
  }
  return (
    <div className="component-preview">
      <Switch label="Enable compiled output" />
    </div>
  )
}

function CompiledCounter() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button onClick={() => setCount((value) => value + 1)}>Increment</Button>
      <output aria-live="polite" className="font-mono text-sm" data-testid="docs-counter">
        Count: {count}
      </output>
    </div>
  )
}

function PageLink({
  direction,
  item,
}: {
  readonly direction: 'Next' | 'Previous'
  readonly item: NonNullable<LoadedDocPage['next']>
}) {
  return (
    <Link
      className="group rounded-xl border p-4 text-sm transition-colors hover:bg-accent"
      href={item.url}
    >
      <span className="text-xs text-muted-foreground">{direction}</span>
      <span className="mt-1 flex items-center gap-2 font-medium">
        {direction === 'Previous' ? (
          <ArrowIcon className="size-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
        ) : null}
        {item.title}
        {direction === 'Next' ? (
          <ArrowIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        ) : null}
      </span>
    </Link>
  )
}
