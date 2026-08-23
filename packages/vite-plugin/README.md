# @vidact/vite

Vite integration for the Vidact Rust compiler.

```ts
import { vidact } from '@vidact/vite'

export default {
  plugins: [vidact()],
}
```

Select `target: 'client' | 'hydrate' | 'server'` per build. Semantic feature
families are enabled with `features`. Dependency TSX remains excluded by
default; opt compatible source packages in explicitly:

```ts
vidact({
  includeDependencies: '**/node_modules/@scope/compatible-source/**',
  exclude: '**/*.generated.tsx',
})
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

For production installs, pass `compilerPath` to a version-matched `vidactc`
artifact. Workspace development builds `target/debug/vidactc` once per process
and invokes that executable directly for subsequent transforms.

The cache fingerprint includes compiler/runtime protocols, filename, source,
target, features, and Vite environment.
