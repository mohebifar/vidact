# Vidact Start example

This app exercises the first Vidact Start vertical slice: generated file routes,
nested layouts, typed loaders, dynamic parameters, route endpoints, SSR, and
hydration. Its `Link` navigation requests server loader snapshots and restores
route content through browser history without reloading the document.

```sh
pnpm dev:start
```

Production builds use separate client and SSR environments:

```sh
pnpm --filter @vidact/example-start build
pnpm --filter @vidact/example-start start
```
