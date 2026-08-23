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

The cache fingerprint includes compiler/runtime protocols, filename, source,
target, features, and Vite environment.
