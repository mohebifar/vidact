import type { VidactNode } from '@vidact/react-types'
import { Link } from '@vidact/start'
import { useState } from 'react'

import { classes } from '@/lib/classes.ts'
import type { NavigationGroup } from '@/lib/docs-types.ts'

import { MenuIcon, MoonIcon, SunIcon } from './icons.tsx'
import { Badge } from './ui/badge.tsx'

type DocsLayoutProps = {
  readonly children: VidactNode
  readonly navigation: readonly NavigationGroup[]
  readonly requestUrl: string
}

export function DocsLayout({ children, navigation, requestUrl }: DocsLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = new URL(requestUrl, 'http://vidact.local').pathname

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <header
        className="fixed inset-x-0 top-0 z-50 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        data-testid="docs-header"
      >
        <div className="mx-auto flex h-full max-w-[90rem] items-center gap-3 px-4 sm:px-6">
          <button
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
            className="inline-flex size-9 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            type="button"
          >
            <MenuIcon className="size-4" />
          </button>
          <Link className="flex items-center gap-2 font-semibold tracking-tight" href="/">
            <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-bold text-background">
              V
            </span>
            <span>Vidact</span>
          </Link>
          <Badge className="hidden sm:inline-flex" variant="secondary">
            docs
          </Badge>
          <nav
            aria-label="Top navigation"
            className="ml-5 hidden items-center gap-5 text-sm lg:flex"
          >
            <Link className="text-foreground" href="/docs">
              Documentation
            </Link>
            <a
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="https://github.com/mohebifar/vidact"
            >
              GitHub
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <button
              aria-label="Toggle color theme"
              className="inline-flex size-9 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={toggleTheme}
              type="button"
            >
              <SunIcon className="hidden size-4 dark:block" />
              <MoonIcon className="size-4 dark:hidden" />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        className={classes(
          'fixed inset-y-0 left-0 z-40 mt-14 w-72 -translate-x-full overflow-y-auto border-r bg-background px-4 py-6 transition-transform lg:translate-x-0',
          mobileOpen && 'translate-x-0',
        )}
        data-testid="docs-sidebar"
      >
        <nav aria-label="Documentation navigation">
          <div className="space-y-7 pb-6">
            {navigation.map((group) => (
              <section key={group.title}>
                <h2 className="mb-2 px-3 text-xs font-semibold tracking-wide text-foreground">
                  {group.title}
                </h2>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <Link
                      aria-current={pathname === item.url ? 'page' : undefined}
                      className={classes(
                        'block rounded-md px-3 py-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                        pathname === item.url && 'bg-accent font-medium text-accent-foreground',
                      )}
                      href={item.url}
                      key={item.url}
                      onClick={() => setMobileOpen(false)}
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </nav>
      </aside>

      <main className="pt-14 lg:pl-72" id="main-content">
        {children}
      </main>
    </div>
  )
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark')
  window.localStorage.setItem('vidact-theme', dark ? 'dark' : 'light')
}
