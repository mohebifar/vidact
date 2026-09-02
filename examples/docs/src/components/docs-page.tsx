import { Link } from '@vidact/start'
import { useState } from 'react'

import { classes } from '@/lib/classes.ts'
import type {
  DocBlock as DocBlockData,
  DocCodeLine,
  DocInline,
  DocInlineLeaf,
  LoadedDocPage,
  PreviewVariant,
} from '@/lib/docs-types.ts'

import { ArrowIcon } from './icons.tsx'
import { Button } from './ui/button.tsx'

type DocsPageProps = { readonly page: LoadedDocPage }

export function DocsPage({ page }: DocsPageProps) {
  const headings = page.sections.filter((section) => section.title !== '')

  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-6 py-12 sm:px-10 sm:py-16 xl:grid-cols-[minmax(0,1fr)_12rem]">
      <article className="min-w-0" data-testid="docs-article">
        <header className="mb-10">
          <p className="text-sm font-medium text-muted-foreground">{page.group}</p>
          <h1 className="mt-2 scroll-m-20 text-4xl font-bold tracking-tight sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            {page.description}
          </p>
        </header>

        <div className="docs-prose space-y-10">
          {page.sections.map((section) => (
            <section id={section.id === '' ? undefined : section.id} key={section.id}>
              {section.title === '' ? null : <h2>{section.title}</h2>}
              <div className={classes('space-y-5', section.title !== '' && 'mt-5')}>
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
        {headings.length === 0 ? null : (
          <div className="sticky top-24">
            <p className="mb-3 text-xs font-semibold">On this page</p>
            <nav aria-label="Table of contents" className="space-y-2 border-l pl-4">
              {headings.map((section) => (
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
        )}
      </aside>
    </div>
  )
}

function DocBlock({ block }: { readonly block: DocBlockData }) {
  if (block.type === 'paragraph') {
    return (
      <p>
        <Inline nodes={block.content} />
      </p>
    )
  }
  if (block.type === 'heading') {
    return (
      <h3 id={block.id}>
        <a className="heading-anchor" href={`#${block.id}`}>
          {block.text}
        </a>
      </h3>
    )
  }
  if (block.type === 'list') {
    return block.ordered ? (
      <ol>
        <ListItems items={block.items} />
      </ol>
    ) : (
      <ul>
        <ListItems items={block.items} />
      </ul>
    )
  }
  if (block.type === 'code') {
    return (
      <CodeBlock
        code={block.code}
        language={block.language}
        lines={block.lines}
        title={block.title}
      />
    )
  }
  if (block.type === 'callout') {
    return (
      <aside
        className={classes(
          'callout rounded-xl border p-5',
          block.tone === 'note' && 'border-sky-500/30 bg-sky-500/10',
          block.tone === 'tip' && 'border-emerald-500/30 bg-emerald-500/10',
          block.tone === 'warning' && 'border-amber-500/30 bg-amber-500/10',
        )}
        data-tone={block.tone}
      >
        <p className="font-semibold text-foreground">{block.title}</p>
        <div className="mt-2 space-y-3 text-[0.95rem] text-foreground/85">
          {block.paragraphs.map((paragraph) => (
            <p key={paragraph.key}>
              <Inline nodes={paragraph.content} />
            </p>
          ))}
        </div>
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
                <th key={header.key} scope="col">
                  <Inline nodes={header.content} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.key}>
                {row.cells.map((cell) => (
                  <td key={cell.key}>
                    <Inline nodes={cell.content} />
                  </td>
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

function ListItems({
  items,
}: {
  readonly items: readonly { readonly content: readonly DocInline[]; readonly key: string }[]
}) {
  return (
    <>
      {items.map((item) => (
        <li key={item.key}>
          <Inline nodes={item.content} />
        </li>
      ))}
    </>
  )
}

function Inline({ nodes }: { readonly nodes: readonly DocInline[] }) {
  return (
    <>
      {nodes.map((node) => (
        <InlineNode key={node.key} node={node} />
      ))}
    </>
  )
}

function InlineNode({ node }: { readonly node: DocInline }) {
  if (node.type === 'text') return <span>{node.value}</span>
  if (node.type === 'code') return <code>{node.value}</code>
  if (node.type === 'break') return <br />
  if (node.type === 'strong') {
    return (
      <strong>
        <Leaves nodes={node.children} />
      </strong>
    )
  }
  if (node.type === 'emphasis') {
    return (
      <em>
        <Leaves nodes={node.children} />
      </em>
    )
  }
  return <InlineLink href={node.href} nodes={node.children} />
}

function InlineLink({
  href,
  nodes,
}: {
  readonly href: string
  readonly nodes: readonly DocInlineLeaf[]
}) {
  const external = /^[a-z]+:/u.test(href)
  if (href.startsWith('/')) {
    return (
      <Link href={href}>
        <Leaves nodes={nodes} />
      </Link>
    )
  }
  return (
    <a
      href={href}
      rel={external ? 'noreferrer' : undefined}
      target={external ? '_blank' : undefined}
    >
      <Leaves nodes={nodes} />
    </a>
  )
}

function Leaves({ nodes }: { readonly nodes: readonly DocInlineLeaf[] }) {
  return (
    <>
      {nodes.map((node) => (
        <Leaf key={node.key} node={node} />
      ))}
    </>
  )
}

function Leaf({ node }: { readonly node: DocInlineLeaf }) {
  return node.type === 'code' ? <code>{node.value}</code> : <span>{node.value}</span>
}

function CodeBlock({
  code,
  language,
  lines,
  title,
}: {
  readonly code: string
  readonly language: string
  readonly lines: readonly DocCodeLine[]
  readonly title: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <div className="not-prose overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-50">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-xs text-zinc-400">
        <span className={classes(title !== '' && 'font-medium text-zinc-200')}>
          {title === '' ? language : title}
        </span>
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

function ComponentPreview({ variant }: { readonly variant: PreviewVariant }) {
  return (
    <div className="component-preview">
      {variant === 'counter' ? <CounterPreview /> : null}
      {variant === 'toggle' ? <TogglePreview /> : null}
      {variant === 'list' ? <ListPreview /> : null}
    </div>
  )
}

function CounterPreview() {
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

function TogglePreview() {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-4">
      <Button onClick={() => setOpen(!open)} variant="outline">
        {open ? 'Hide details' : 'Show details'}
      </Button>
      {open ? (
        <p className="text-sm text-muted-foreground" data-testid="docs-toggle-details">
          This paragraph was created when you opened it and is removed when you close it.
        </p>
      ) : null}
    </div>
  )
}

function ListPreview() {
  const [items, setItems] = useState(['Compile', 'Mount', 'Update'])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setItems(items.toReversed())} variant="outline">
          Reverse
        </Button>
        <Button onClick={() => setItems([...items, `Item ${items.length + 1}`])} variant="outline">
          Add
        </Button>
        <Button onClick={() => setItems(items.slice(1))} variant="outline">
          Remove first
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2 text-sm" data-testid="docs-list">
        {items.map((item) => (
          <li className="rounded-md border bg-background px-3 py-1" key={item}>
            {item}
          </li>
        ))}
      </ul>
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
