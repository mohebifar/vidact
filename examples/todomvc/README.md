# Vidact TodoMVC

This is the first runnable Vidact application. Its source is ordinary
React-shaped TSX with `useState`, array operations, JSX event handlers, and keyed
`map` expressions. The production bundle contains the small Vidact runtime and
direct DOM construction calls; it does not include React or a Virtual DOM.

## Run it

From the repository root:

```sh
pnpm install
pnpm dev:todomvc
```

Open the URL printed by Vite. The first TSX transform may take a moment while
Cargo builds `vidactc`; later transforms use the incremental Rust build.

You can also run the example's gates directly:

```sh
pnpm --filter @vidact/example-todomvc typecheck
pnpm --filter @vidact/example-todomvc test
pnpm --filter @vidact/example-todomvc build
```

## What the plugin does

1. `@vidact/vite` sends the untouched TSX source to `vidactc`.
2. The Rust compiler runs the vendored React Compiler analysis and returns a
   versioned Vidact source/updater manifest.
3. Vite's OXC transform lowers JSX through `@vidact/runtime/jsx-runtime`.
4. The runtime creates real DOM nodes and flattens array children directly.

This is intentionally called the analysis-first compatibility path. State
changes currently rerun the component and replace its root node. It proves the
complete Vite-to-browser workflow and makes TodoMVC testable now, while the
production compiler path continues toward targeted DOM updates and keyed range
reconciliation.
