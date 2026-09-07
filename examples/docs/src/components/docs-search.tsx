import { Link } from '@vidact/start'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { MAX_SEARCH_LENGTH, type DocsSearchResult } from '@/lib/search-types.ts'
import { fetchDocsSearch, OPEN_DOCS_SEARCH, openDocsSearch } from '@/lib/search.ts'

export function SearchButton() {
  const [shortcut, setShortcut] = useState('Ctrl K')
  useEffect(() => {
    if (/Mac|iPhone|iPad/u.test(navigator.platform)) setShortcut('⌘ K')
  }, [])
  return (
    <button
      aria-label="Search documentation"
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className="search-trigger"
      onClick={openDocsSearch}
      type="button"
    >
      <SearchIcon />
      <span className="hidden sm:inline">Search docs</span>
      <kbd aria-hidden="true" className="hidden sm:inline">
        {shortcut}
      </kbd>
    </button>
  )
}

/** One instance in the retained root serves both site headers. */
export function DocsSearch() {
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    const show = () => setOpen(true)
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.isComposing &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        if (!event.repeat) setOpen((value) => !value)
      }
    }
    document.addEventListener(OPEN_DOCS_SEARCH, show)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener(OPEN_DOCS_SEARCH, show)
      document.removeEventListener('keydown', keyboard)
    }
  }, [])
  return open ? <SearchDialog onClose={() => setOpen(false)} /> : null
}

function SearchDialog({ onClose }: { readonly onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly DocsSearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [active, setActive] = useState(0)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    const cancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', cancel)
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => {
      dialog.removeEventListener('cancel', cancel)
      dialog.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  useLayoutEffect(() => {
    const term = query.trim()
    setActive(0)
    setResults([])
    if (term === '') {
      setStatus('idle')
      return
    }
    setStatus('loading')
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetchDocsSearch(term, controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return
          setResults(items)
          setStatus('ready')
        })
        .catch(() => {
          if (!controller.signal.aborted) setStatus('error')
        })
    }, 150)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || results.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
      setActive(next)
      document.getElementById(`docs-search-result-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      dialogRef.current?.querySelector<HTMLAnchorElement>(`#docs-search-result-${active}`)?.click()
    }
  }

  return (
    <dialog
      aria-label="Search documentation"
      className="docs-search-dialog"
      ref={dialogRef}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          const bounds = dialogRef.current.getBoundingClientRect()
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose()
        }
      }}
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <SearchIcon />
        <input
          aria-label="Search documentation"
          aria-autocomplete="list"
          aria-controls="docs-search-results"
          aria-expanded={results.length > 0}
          aria-activedescendant={results.length > 0 ? `docs-search-result-${active}` : undefined}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none"
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keyboard}
          placeholder="Search guides, APIs, and examples…"
          ref={inputRef}
          role="combobox"
          type="text"
          value={query}
        />
        <button aria-label="Close search" className="search-close" onClick={onClose} type="button">
          Esc
        </button>
      </div>
      <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
        <p className="sr-only" role="status">
          {status === 'loading'
            ? 'Searching…'
            : status === 'ready'
              ? `${results.length} results`
              : ''}
        </p>
        {status === 'idle' ? (
          <div className="p-3">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Start here</p>
            <Link
              className="search-suggestion"
              href="/docs/getting-started/quick-start"
              onClick={onClose}
            >
              Quick start <span>Create your first app</span>
            </Link>
            <Link
              className="search-suggestion"
              href="/docs/reference/react-compatibility"
              onClick={onClose}
            >
              React compatibility <span>Check supported APIs</span>
            </Link>
          </div>
        ) : null}
        {status === 'loading' ? (
          <p className="p-6 text-sm text-muted-foreground">Searching…</p>
        ) : null}
        {status === 'error' ? (
          <p className="p-6 text-sm" role="alert">
            Search is unavailable. Change your query to try again.
          </p>
        ) : null}
        {status === 'ready' && results.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No results for “{query}”. Try an API name or a shorter phrase.
          </p>
        ) : null}
        <div aria-label="Search results" id="docs-search-results" role="listbox">
          {results.map((result, index) => (
            <Link
              aria-selected={active === index}
              className="search-result"
              href={result.url}
              id={`docs-search-result-${index}`}
              key={result.id}
              onClick={onClose}
              onMouseMove={() => setActive(index)}
              role="option"
              tabIndex={-1}
            >
              <span className="block text-xs text-muted-foreground">
                {result.group} / {result.title}
              </span>
              <span className="mt-1 line-clamp-2 text-sm leading-6">{result.content}</span>
            </Link>
          ))}
        </div>
      </div>
      <div className="border-t px-4 py-3 text-xs text-muted-foreground">
        ↑ ↓ to select <span className="ml-4">↵ to open</span>
      </div>
    </dialog>
  )
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}
