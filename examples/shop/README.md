# Vidact Shop

Northstar Supply is a complete sample application built from ordinary React-shaped TSX and
compiled by Vidact. It demonstrates a production-shaped request path rather than mounting a
client-only demo:

- a fetch-native `srvx` backend with product, checkout, and health JSON endpoints;
- async server rendering through `renderToReadableStream`;
- an explicit server component that emits a manifest-checked client boundary;
- a code-split `"use client"` module loaded only when that boundary hydrates;
- fulfilled catalog markup claimed without replacement while input events are replayable;
- owner-safe Vite HMR that replaces the hydrated client boundary;
- category refetches that reveal a skeleton grid through `Suspense` and `use(promise)`;
- application-owned shadcn components using the Lyra preset, Neutral tokens, and published Base UI
  primitives compiled from `node_modules` without a package include list;
- client-side search, category filters, cart quantities, totals, and mock checkout;
- browser assertions for surgical mutations and retained node identity, plus separate server, HMR,
  production-artifact, and production-start tests.

## Run it

From the repository root:

```sh
pnpm install
pnpm dev:shop
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The development command runs Vite with
separate client and SSR environments. TSX, server-rendering, and CSS changes update without a
manual rebuild. Set `PORT` to choose another port.

The example's gates can also run directly:

```sh
pnpm --filter @vidact/example-shop typecheck
pnpm --filter @vidact/example-shop test
pnpm --filter @vidact/example-shop build
pnpm --filter @vidact/example-shop verify:bundle
pnpm --filter @vidact/example-shop test:start
pnpm --filter @vidact/example-shop start
```

`verify:bundle` checks every emitted JavaScript chunk for React runtime paths, generic element-tree
interpretation, structural reconciliation, and dependency-specific adapters. `test:start` launches
the built server on an isolated port, checks health, HTML, and assets, then hydrates and exercises
the production shop while proving representative server nodes retain identity.

## Request flow

1. Vite's SSR environment loads `src/server.ts`, which renders `ShopPage.server.tsx`. Production
   runs the same fetch handler through `srvx`.
2. The server component waits for the catalog, renders `ShopApp.tsx`, and emits it inside an
   explicit `shop/ShopClient#shop` boundary checked against the application's client manifest.
3. The boundary payload carries only the checked client reference and its closed, versioned props
   model. The full catalog markup remains ordinary HTML inside a deterministic nested root.
4. `src/client.ts` installs event replay, dynamically imports `ShopClient.client.tsx`, prewarms its
   resource, and claims the existing nodes. It never resolves a serialized module path directly.
5. In development, accepting the client module asks the hydrated boundary to replace its owned
   range while retaining the server component's boundary host.
6. Category and refresh controls request `/api/products`; the new promise suspends only the grid
   until its response arrives.
7. Checkout posts product IDs and quantities to `/api/checkout`, where the backend re-prices the
   trusted catalog data and returns a mock receipt.

Production intentionally uses separate Vite client and server builds. Development applies one
Vidact plugin instance to Vite's `client` environment with the hydrate target and another to its
`ssr` environment with the server target. The client entry contains a lexical
`import.meta.hot.accept()` call because Vite discovers HMR boundaries statically; the runtime
helper then owns root reuse, disposal, and pruning. Hot replacement resets component-local state
by design, while state in a stable external store can survive replacement.

This is Vidact's current Server Component contract: an explicit server/client boundary, an
application-owned manifest and module loader, SSR markup retention, async preparation, event
replay, and independent hydration. It intentionally does not claim React Flight compatibility or
automatic `"use client"` module-graph splitting; a framework adapter can generate the manifest and
loader above these primitives.
