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
2. The Rust compiler runs the vendored React Compiler analysis, lowers a static
   updater graph, and rewrites state, scalar, branch, and keyed-list expressions.
3. OXC Codegen prints the transformed TSX; Vite's OXC transform then lowers JSX
   through `@vidact/runtime/jsx-runtime`.
4. The runtime constructs the component DOM once and runs only bindings whose
   compiler-assigned source masks intersect the state change.

The browser test asserts more than visible output: toggling one todo preserves
the app root, an unrelated keyed `<li>`, and partially typed input. Filtering,
editing, removing, and clearing still work without a Virtual DOM. This remains
a bounded compiler slice rather than a production compatibility promise; see
the repository README for the missing production gates.
