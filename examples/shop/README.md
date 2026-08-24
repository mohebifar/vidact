# Vidact Shop

Northstar Supply is a complete sample application built from ordinary React-shaped TSX and
compiled by Vidact. It demonstrates a production-shaped request path rather than mounting a
client-only demo:

- a fetch-native `srvx` backend with product, checkout, and health JSON endpoints;
- async server rendering through `renderToReadableStream`;
- server and hydrate compiler targets built from the same `ShopApp.tsx` source;
- fulfilled catalog markup claimed without replacement during hydration;
- owner-safe Vite HMR after that initial hydration;
- category refetches that reveal a skeleton grid through `Suspense` and `use(promise)`;
- client-side search, category filters, cart quantities, totals, and mock checkout;
- separate browser and server tests.

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
pnpm --filter @vidact/example-shop start
```

## Request flow

1. Vite's SSR environment loads `src/server.ts`, which passes the catalog promise to the
   server-compiled shop. Production runs the same fetch handler through `srvx`.
2. Vidact's async server renderer waits for the Suspense resource and emits the full product grid
   plus hydration markers.
3. The server serializes the same products into a non-executable JSON script.
4. `src/client.ts` prewarms that data as a fulfilled resource and hydrates the existing nodes.
   In development, `hydrateHotRoot` reuses the hydrated root for later module evaluations.
5. Category and refresh controls request `/api/products`; the new promise suspends only the grid
   until its response arrives.
6. Checkout posts product IDs and quantities to `/api/checkout`, where the backend re-prices the
   trusted catalog data and returns a mock receipt.

Production intentionally uses separate Vite client and server builds. Development applies one
Vidact plugin instance to Vite's `client` environment with the hydrate target and another to its
`ssr` environment with the server target. The client entry contains a lexical
`import.meta.hot.accept()` call because Vite discovers HMR boundaries statically; the runtime
helper then owns root reuse, disposal, and pruning. Hot replacement resets component-local state
by design, while state in a stable external store can survive replacement.
