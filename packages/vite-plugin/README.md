# @vidact/vite

Vite integration for the Vidact Rust compiler.

```ts
import { vidact } from '@vidact/vite'

export default {
  plugins: [vidact()],
}
```

Select `target: 'client' | 'hydrate' | 'server'` per build. Semantic feature
families are enabled with `features`.

Reachable package modules are compiled automatically when their owning package
declares `react` or `react-dom` in `dependencies`, `peerDependencies`, or
`optionalDependencies`. Qualification follows the resolved real path, so pnpm
virtual-store entries and linked packages retain their owning package identity.
The plugin does not scan all of `node_modules` and does not use package-name
allowlists.

Use `includeDependencies` only for compatible packages whose metadata does not
declare React. Use `exclude` to leave any matching source or dependency module
untouched; exclusion wins over inclusion:

```ts
vidact({
  includeDependencies: '**/node_modules/@scope/compatible-source/**',
  exclude: ['**/*.generated.tsx', '**/node_modules/renderer-dependent/**'],
})
```

Each qualified entry is flattened into a single target-specific ESM capsule
before compilation. React imports remain external so the compiler can classify
them by semantic identity; ordinary non-React dependencies remain on Vite's
normal path. Capsule source maps compose back to published package files, all
contributors are watched for HMR, and target/features/environment/defines are
part of the cache fingerprint.

Published JavaScript may be minified. Shortened direct import aliases for
`jsx`, `jsxs`, `jsxDEV`, `createElement`, and supported hooks remain analyzable.
Bundles that erase or escape React import provenance fail with package, version,
entry, target, construct, and mapped-source context. There is no React runtime
fallback.

Element-valued render props use a bounded compiled-renderable capability for
known construction sites; callback render props return ordinary compiled
values. This supports the published Base UI Button, Input, and Toggle Group
paths exercised by the repository, but does not provide a React element-tree
interpreter or reconciler. Dynamic props destructured into untracked body locals
remain unsupported and may retain their construction-time value.

Compile JSX emitted by an earlier Vite transform by adding its source extension. This enables
MDX when the MDX plugin runs before Vidact and preserves JSX output:

```ts
plugins: [
  { ...mdx({ jsx: true }), enforce: 'pre' },
  vidact({ extensions: ['.tsx', '.mdx'] }),
]
```

Use `features: ['async']` to enable compiler-staged `Suspense`, `lazy`, and
`use(promise)`. The plugin selects isolated async client, hydrate, or server
runtime entries; disabled syntax receives a source-located diagnostic.

Use `features: ['concurrent']` for `startTransition`, `useTransition`,
`useDeferredValue`, and `flushSync`. Deferred writes use cancellable scheduler
lanes and atomic compiled publication. Combine `async` and `concurrent` when an
application needs both families; the plugin selects a composed entry without
adding unused capability code.

Use `features: ['actions']` for `useActionState`, `useOptimistic`,
`useFormStatus`, and function-valued `action`/`formAction` props. The compiler
rewrites forms to an owned status/reset boundary and selects isolated client,
hydrate, or server Actions entries. Add `async` when Actions and Suspense are
used together. Public transition APIs still require the separate `concurrent`
feature even though Actions reuse its publication machinery internally.

The plugin calls the prebuilt `@vidact/compiler` Node-API addon. Consumers do
not need Rust, Cargo, or a separate `vidactc` executable; the command-line tool
is a thin wrapper over the same package API.

The plugin defaults `optimizeDeps.noDiscovery` and `ssr.noExternal` to `true` so
qualified modules remain visible to Vidact. Explicit user values are preserved.
The cache fingerprint includes compiler/runtime protocols, filename, source or
capsule fingerprint, target, features, and Vite environment.
