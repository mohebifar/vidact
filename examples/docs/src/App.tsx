import * as React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'

import {
  crossModuleHookComponents,
  externalReactPackageComponents,
  ownerCertifiedShadcnComponents,
  productionOnlyShadcnComponents,
  unsupportedBaseUiComponents,
} from './shadcn-compatibility.ts'

const certifiedCount = Object.keys(ownerCertifiedShadcnComponents).length
const productionOnlyCount = Object.keys(productionOnlyShadcnComponents).length
const productionCompiledCount = certifiedCount + productionOnlyCount
const blockedCount =
  Object.keys(externalReactPackageComponents).length +
  Object.keys(crossModuleHookComponents).length +
  Object.keys(unsupportedBaseUiComponents).length

export function App() {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [dark, setDark] = React.useState(false)

  function toggleTheme() {
    const nextDark = !dark
    setDark(nextDark)
    document.documentElement.classList.toggle('dark', nextDark)
  }

  return (
    <div className="docs-app">
      <header className="topbar" data-testid="topbar">
        <div className="topbar-inner">
          <Button
            className="mobile-menu-button"
            variant="ghost"
            size="icon"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">☰</span>
          </Button>
          <a className="brand" href="#top" aria-label="Vidact docs home">
            <span className="brand-mark" aria-hidden="true">
              V
            </span>
            <span>Vidact</span>
            <span className="version">v0.1</span>
          </a>
          <nav className="primary-nav" aria-label="Primary navigation">
            <a className="active" href="#guide">
              Guide
            </a>
            <a href="#components">Components</a>
            <a href="#compatibility">Compatibility</a>
          </nav>
          <div className="topbar-actions">
            <Button variant="ghost" size="sm" onClick={toggleTheme} aria-label="Toggle color theme">
              <span aria-hidden="true">{dark ? '☀' : '◐'}</span>
              <span className="theme-label">{dark ? 'Light' : 'Dark'}</span>
            </Button>
            <a className="github-link" href="https://github.com/mohebifar/vidact">
              GitHub ↗
            </a>
          </div>
        </div>
      </header>

      <div className="docs-layout">
        <aside className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'} data-testid="sidebar">
          <div className="sidebar-search">
            <label className="sr-only" htmlFor="docs-search">
              Filter documentation
            </label>
            <Input
              id="docs-search"
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search docs…"
              aria-label="Filter documentation"
            />
            <Kbd>⌘ K</Kbd>
          </div>
          <nav className="sidebar-nav" aria-label="Documentation">
            <p className="nav-section-label">Getting started</p>
            {query.length === 0 ||
            'introduction overview fumadocs'.includes(query.trim().toLowerCase()) ? (
              <a className="active" href="#introduction">
                Introduction
              </a>
            ) : null}
            {query.length === 0 ||
            'installation vite setup'.includes(query.trim().toLowerCase()) ? (
              <a href="#installation">Installation</a>
            ) : null}
            <p className="nav-section-label">Reference</p>
            {query.length === 0 ||
            'components shadcn base ui'.includes(query.trim().toLowerCase()) ? (
              <a href="#components">Components</a>
            ) : null}
            {query.length === 0 ||
            'compatibility compiler status'.includes(query.trim().toLowerCase()) ? (
              <a href="#compatibility">Compatibility lab</a>
            ) : null}
            {query.length > 0 &&
            !'introduction overview fumadocs'.includes(query.trim().toLowerCase()) &&
            !'installation vite setup'.includes(query.trim().toLowerCase()) &&
            !'components shadcn base ui'.includes(query.trim().toLowerCase()) &&
            !'compatibility compiler status'.includes(query.trim().toLowerCase()) ? (
              <p className="no-results">No pages match “{query}”.</p>
            ) : null}
          </nav>
          <div className="sidebar-footnote">
            <span className="status-dot" />
            Built without React interop
          </div>
        </aside>

        {menuOpen ? (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}

        <main className="article" id="top" data-testid="article">
          <div className="article-inner">
            <div className="eyebrow">Guide · Getting started</div>
            <h1 id="introduction">Documentation, compiled away.</h1>
            <p className="lede">
              A Fumadocs-inspired documentation shell rebuilt from the current shadcn Base UI
              registry, compiled to direct DOM operations by Vidact.
            </p>
            <div className="hero-actions">
              <Button size="lg">Start building</Button>
              <Button size="lg" variant="outline">
                Explore components
              </Button>
            </div>

            <Alert className="proof-alert">
              <span className="proof-icon" aria-hidden="true">
                ✓
              </span>
              <AlertTitle>No compatibility runtime</AlertTitle>
              <AlertDescription>
                The production verifier rejects React, React DOM, element tags, and compatibility
                adapters.
              </AlertDescription>
            </Alert>

            <section id="installation">
              <h2>Installation</h2>
              <p>
                Author ordinary React-shaped TSX. The Vite plugin lowers the supported subset into
                stable DOM owners and surgical updates.
              </p>
              <div className="code-window" aria-label="Install command">
                <div className="code-window-bar">
                  <span />
                  <span />
                  <span />
                </div>
                <pre>
                  <code>
                    <span className="code-muted">$</span> pnpm add @vidact/runtime @vidact/vite
                  </code>
                </pre>
              </div>
            </section>

            <section id="components">
              <div className="section-heading">
                <div>
                  <h2>Built on shadcn and Base UI</h2>
                  <p>Keep the familiar local component model. Change the renderer.</p>
                </div>
                <span className="count-badge">
                  {productionCompiledCount} production-compiled modules
                </span>
              </div>
              <div className="feature-grid">
                <Card>
                  <CardHeader>
                    <span className="feature-number">01</span>
                    <CardTitle>Local source</CardTitle>
                    <CardDescription>
                      Components live in your repo and remain editable.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <code>src/components/ui</code>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <span className="feature-number">02</span>
                    <CardTitle>Base UI behavior</CardTitle>
                    <CardDescription>
                      Headless interaction primitives keep their accessible contracts.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <code>@base-ui/react</code>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <span className="feature-number">03</span>
                    <CardTitle>Direct DOM output</CardTitle>
                    <CardDescription>
                      State updates patch owned nodes without a virtual DOM renderer.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <code>@vidact/runtime</code>
                  </CardContent>
                </Card>
              </div>
            </section>

            <Separator />

            <section id="compatibility">
              <div className="section-heading">
                <div>
                  <h2>Compatibility is a proof, not a promise</h2>
                  <p>
                    The registry corpus is classified by the first semantic boundary in each module.
                  </p>
                </div>
              </div>
              <div className="compat-table" role="table" aria-label="shadcn compatibility summary">
                <div className="compat-row compat-head" role="row">
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Modules</span>
                  <span role="columnheader">Policy</span>
                </div>
                <div className="compat-row" role="row">
                  <span role="cell">
                    <i className="status-dot" />
                    Certified
                  </span>
                  <strong role="cell">{certifiedCount}</strong>
                  <span role="cell">Browser interaction and stable-owner proof</span>
                </div>
                <div className="compat-row" role="row">
                  <span role="cell">
                    <i className="status-dot status-warn" />
                    Owner proof pending
                  </span>
                  <strong role="cell">{productionOnlyCount}</strong>
                  <span role="cell">React-free build; owner proof is absent or still fails</span>
                </div>
                <div className="compat-row" role="row">
                  <span role="cell">
                    <i className="status-dot status-warn" />
                    Diagnosed
                  </span>
                  <strong role="cell">{blockedCount}</strong>
                  <span role="cell">Fails closed at an ownership boundary</span>
                </div>
              </div>
            </section>

            <nav className="page-footer" aria-label="Page navigation">
              <a href="#introduction">
                <span>Previous</span>
                <strong>Overview</strong>
              </a>
              <a href="#installation" className="next">
                <span>Next</span>
                <strong>Installation →</strong>
              </a>
            </nav>
          </div>
        </main>

        <aside className="toc" aria-label="On this page">
          <p>On this page</p>
          <a className="active" href="#introduction">
            Introduction
          </a>
          <a href="#installation">Installation</a>
          <a href="#components">Components</a>
          <a href="#compatibility">Compatibility</a>
          <Separator />
          <a className="toc-action" href="https://github.com/mohebifar/vidact/issues">
            Question? Give feedback ↗
          </a>
        </aside>
      </div>
    </div>
  )
}
