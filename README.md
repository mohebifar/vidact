<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/docs/public/logo-128-dark.png">
  <img src="examples/docs/public/logo-128.png" alt="Vidact logo" width="96">
</picture>

# Vidact

**Write React. Ship direct DOM code.**

[![CI](https://github.com/mohebifar/vidact/actions/workflows/ci.yml/badge.svg)](https://github.com/mohebifar/vidact/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@vidact/runtime?label=%40vidact%2Fruntime)](https://www.npmjs.com/package/@vidact/runtime)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Overview](#overview) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Packages](#packages) · [Examples](#examples) · [Development](#development)

</div>

Vidact is a compiler for React-shaped components. You write function components, JSX, and hooks exactly the way you would in a React application. Instead of shipping React, Vidact compiles each component into plain DOM operations: create these elements once, and when this piece of state changes, update this text node.

There is no Virtual DOM, no reconciler, and no React runtime in your bundle.

> [!WARNING]
> Vidact is in beta. APIs are stabilizing and the supported subset of React is growing. Pin `@vidact/runtime`, `@vidact/vite`, and `@vidact/start` to matching versions and run your test suite against the versions you ship.

## Overview

Components run **once**, when they mount. The compiler reads each function ahead of time, works out which parts of the output depend on which values, and emits a fixed list of small updaters. A state write runs only the updaters that read that state. The component function is never called again.

```tsx
import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div>
      <button onClick={() => setCount((value) => value + 1)}>Increment</button>
      <output>Count: {count}</output>
    </div>
  )
}
```

Compiled by Vidact, this builds a `<div>`, a `<button>`, and an `<output>` once, then keeps one updater that rewrites the text node whenever `count` changes.

**Why Vidact?**

- **Small bundles.** A compiled counter is about 8 kB gzipped with the runtime included, because there is no reconciler to download.
- **Predictable updates.** A state write runs a known list of updaters, so there are no surprise re-renders, no stale closures, and no `memo` to keep things fast.
- **Familiar API.** `useState`, `useEffect`, `useContext`, `useRef`, and the rest work the way you expect, and most React components compile without changes.
- **Loud failures.** Code Vidact cannot compile fails the build at the exact source location instead of falling back to a slower path.
- **Full stack when you want it.** [Vidact Start](packages/start) adds file-based routing, loaders, server rendering, hydration, and client navigation.

**What Vidact is not.** Vidact is not a React renderer and does not run React. There is no element tree, no Fiber, and no React DevTools. Class components, `React.Children`, and libraries that reach into React internals are not supported. See the [React compatibility matrix](docs/react-compatibility.md) for the full contract.

## Quick start

The fastest way to start is the project generator:

```sh
npx vidact my-app
```

It asks for a template and leaves you with a project you can run:

| Template | What you get                                                                |
| -------- | --------------------------------------------------------------------------- |
| `spa`    | Vite, the Vidact compiler plugin, and a client-rendered entry point         |
| `start`  | Vidact Start with file routes, loaders, server rendering, and hydration     |
| `nitro`  | The same full-stack app served by Nitro, with a preset for every major host |

### Manual setup

Install the runtime, the Vite plugin, and the React-shaped types. `react` and `react-dom` are missing from this list on purpose: your source imports from `react`, and the Vite plugin resolves those imports to the compiled runtime.

```sh
pnpm add @vidact/runtime
pnpm add -D @vidact/vite @vidact/react-types @types/react typescript vite
```

Add the plugin to Vite. It compiles every `.tsx` file in the project.

```ts
// vite.config.ts
import { vidact } from '@vidact/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vidact()],
})
```

Tell TypeScript to leave JSX alone and to type it with Vidact's React-shaped declarations:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@vidact/react-types",
    "types": ["@vidact/react-types", "vite/client"]
  }
}
```

Mount a component. `mountCompiled` takes the component itself rather than a JSX element, because a compiled component is a factory that builds its own DOM.

```ts
// src/main.ts
import { mountCompiled } from '@vidact/runtime'

import { Counter } from './Counter.tsx'

mountCompiled(Counter, document.querySelector('#app')!)
```

Then run `pnpm vite` for development or `pnpm vite build` for a static production build.

> [!NOTE]
> The compiler and runtime share a protocol version. Always upgrade `@vidact/runtime`, `@vidact/vite`, and `@vidact/start` together. Mixed versions fail loudly at startup rather than silently misbehaving.

### Opt-in features

Suspense, transitions, form actions, and retained UI are part of React's API and all work as expected, but they stay out of your bundle until you enable them:

```ts
vidact({ features: ['async', 'concurrent'] })
```

| Feature       | What it enables                                                                     |
| ------------- | ----------------------------------------------------------------------------------- |
| `async`       | `Suspense`, `lazy`, and `use(promise)`                                              |
| `concurrent`  | `useTransition`, `startTransition`, `useDeferredValue`, `flushSync`                 |
| `actions`     | Function-valued form `action`, `useActionState`, `useOptimistic`, `useFormStatus`   |
| `retained-ui` | `Activity` for hiding UI while keeping its state                                    |

Using a feature that is not enabled produces a compile error naming the flag.

### Full-stack with Vidact Start

Swap the plugin for `vidactStart()` and add a `src/routes` directory. Each route module exports a `Route` with an optional server `loader`; its result reaches the component as typed `loaderData`.

```tsx
// src/routes/index.tsx
import { defineFileRoute, type RouteComponentProps } from '@vidact/start'

const loader = () => ({ greeting: 'Hello from the server' })

export function HomeRoute({ loaderData }: RouteComponentProps<ReturnType<typeof loader>>) {
  return <h1>{loaderData.greeting}</h1>
}

export const Route = defineFileRoute({ loader, component: HomeRoute })
```

The server renders HTML with the loader's data, embeds a snapshot, and the client hydrates the existing DOM without rebuilding it. See the [@vidact/start README](packages/start/README.md) and the [Start guides](examples/docs/content/docs/start) for entries, navigation, data loading, and deployment.

## How it works

```text
React source
  -> React Compiler analysis in Rust (AST, scope, HIR/CFG/SSA, dependencies)
  -> Vidact analysis adapter
  -> Vidact static updater IR
  -> Vanilla DOM codegen
  -> @vidact/runtime
```

1. `@vidact/vite` sends untouched TSX to `@vidact/compiler`, a prebuilt native Node-API addon. Consumers never need Rust or Cargo.
2. The Rust compiler runs a vendored React Compiler analysis, lowers a static updater graph, and rewrites state, scalar, branch, and keyed-list expressions.
3. OXC prints the transformed module and lowers JSX through `@vidact/runtime/jsx-runtime`.
4. At runtime the component constructs its DOM once. A state write marks a compiler-assigned source dirty; updaters are emitted in execution order with static read/write masks, so the browser never discovers dependencies or diffs a tree.

React Compiler is an analysis dependency, not Vidact's renderer or code generator. Its internal types terminate at a narrow adapter, and the rest of Vidact uses its own stable facts and IR. The [architecture notes](docs/architecture) record these decisions and the [analysis boundary](docs/architecture/react-analysis-boundary.md) explains the integration constraints.

Reachable `node_modules` packages that declare `react` as a dependency are compiled automatically, which is how published component libraries such as Base UI and shadcn components work without an allowlist.

## Packages

| Package                                        | Role                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [`vidact`](packages/cli)                       | Project generator with `spa`, `start`, and `nitro` templates                  |
| [`@vidact/runtime`](packages/runtime)          | Fine-grained direct-DOM runtime: scheduler, state slots, roots, keyed ranges  |
| [`@vidact/vite`](packages/vite-plugin)         | Vite plugin that compiles `.tsx` files and resolves `react` imports           |
| [`@vidact/react-types`](packages/react-types)  | JSX and hook types describing what Vidact actually does, built on `@types/react` |
| [`@vidact/start`](packages/start)              | File routes, loaders, SSR, hydration, and client navigation                   |
| [`@vidact/compiler`](packages/compiler)        | Native compiler bindings and the `vidactc` CLI, for tooling authors           |
| [`@vidact/test-support`](packages/test-support) | `act` and DOM mutation assertions for Vitest browser tests                    |

The Rust side lives in [`crates/vidact-compiler`](crates/vidact-compiler) (analysis facts and updater IR) and [`crates/vidact-node`](crates/vidact-node) (the Node-API adapter).

## Examples

Every example is ordinary React-shaped TSX. Run them from the repository root after the [development setup](#development).

| Example                        | Command             | Highlights                                                                                      |
| ------------------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| [TodoMVC](examples/todomvc)    | `pnpm dev:todomvc`  | Array state, keyed lists, and events with no Virtual DOM                                        |
| [Shop](examples/shop)          | `pnpm dev:shop`     | Streaming SSR, `"use client"` boundaries, Suspense, Tailwind, shadcn and Base UI from `node_modules` |
| [Start](examples/start)        | `pnpm dev:start`    | Nested layouts, typed loaders, dynamic params, route endpoints, hydration                        |
| [Docs](examples/docs)          | `pnpm dev:docs`     | The documentation site itself, built with Vidact Start and headless Fumadocs, deployed on Nitro |

The user documentation is written in [`examples/docs/content/docs`](examples/docs/content/docs): a quick start, a Learn section covering one concept per page, Vidact Start guides, a [migration guide from React](examples/docs/content/docs/guides/migrating-from-react.mdx), a [testing guide](examples/docs/content/docs/guides/testing.mdx), and per-package references.

## Development

Requirements: Rust 1.96, Node.js 24+, pnpm 10, and Playwright's Chromium, Firefox, and WebKit installs.

```sh
scripts/prepare-oxc.sh   # initialize the pinned Oxc submodule and apply the React Compiler patch
pnpm install
pnpm build:packages
pnpm typecheck
cargo test --workspace
pnpm test:browser
```

`pnpm check` runs everything CI runs: lint and format gates, type checks, the Rust suite, the cross-browser corpus, package and example verification, production size budgets, and compiler and runtime benchmarks.

> [!TIP]
> Ordinary builds do not need Go. Only maintainers editing the checked-in Oxc patch install `git-go-patch` with `go install github.com/microsoft/go-infra/cmd/git-go-patch@v0.0.16`. See [patched Oxc submodule](docs/architecture/patched-oxc-submodule.md).

Every pull request needs a changeset. Run `pnpm changeset` for a published package change, or `pnpm changeset --empty` for repository-only work. Merged changesets feed the automated Version Packages pull request described in the [release policy](docs/release-policy.md).

Repository layout:

- `crates/`: the Rust compiler and its Node-API adapter
- `packages/`: the published npm packages
- `examples/`: runnable applications, including the docs site
- `tests/browser`: compiled Vitest Browser corpora run in Chromium, Firefox, and WebKit
- `docs/architecture`: durable architecture decisions and upstream constraints
- `docs/lint-rules`: the ast-grep rules enforced across the workspace
- `vendor/oxc` and `patches/oxc`: the pinned Oxc submodule and Vidact's patch series
