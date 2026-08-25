# @vidact/start

Vidact-native full-stack framework primitives for file routes, server rendering,
and hydration.

This first release owns the route manifest and request lifecycle while keeping
the renderer boundary explicit. It supports directory-based routes, nested
layouts, loaders, server endpoints, SSR, and initial hydration on Vite and Node.
`Link` and the hydrated client add cancellable same-document navigation and
browser-history restoration. Route preloading, middleware, and deployment
adapters remain future work.

```ts
// vite.config.ts
import { vidactStart } from '@vidact/start/vite'

export default {
  plugins: [vidactStart()],
}
```

```tsx
// src/routes/index.tsx
import { defineFileRoute, Link, type RouteComponentProps } from '@vidact/start'

const loader = () => ({ greeting: 'Hello from Vidact Start' })

export function HomeRoute({
  loaderData,
}: RouteComponentProps<ReturnType<typeof loader>>) {
  return (
    <main>
      <h1>{loaderData.greeting}</h1>
      <Link href="/products">Products</Link>
    </main>
  )
}

export const Route = defineFileRoute({ loader, component: HomeRoute })
```

Route files are exposed through `virtual:vidact-start/routes`. Add
`import '@vidact/start/virtual'` to a declaration file included by the
application. Route components must be named functions so the Vidact compiler
can identify and lower them.

`Link` renders an ordinary anchor during SSR. After hydration, unmodified clicks
on same-origin Start routes request a server loader snapshot, replace the owned
route root, and update browser history without loading another document.
External URLs, downloads, modified clicks, `target` links, hash-only links, and
links with `reloadDocument` retain native browser behavior. Use `replace` to
replace the current history entry.

```tsx
<Link href="/products/42">Product 42</Link>
<Link href="/login" replace>Sign in</Link>
<Link href="/report.pdf" reloadDocument>Download report</Link>
```

`hydrateStart()` returns a `StartClient` whose `navigate()` method provides the
same behavior for programmatic navigation.

This first navigation contract replaces the owned route root atomically, so
component-local state in shared layouts resets. Retaining unchanged layout
owners is a follow-up routing contract.
