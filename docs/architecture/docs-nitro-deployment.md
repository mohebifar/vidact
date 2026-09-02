# Docs deployment through Nitro

- Decision state: Accepted
- Decided: 2026-09-02

## Context

The docs example's standalone Node SSR build did not register a Vercel function. A docs-specific
Build Output API writer addressed the missing function but required maintaining host packaging
and request adaptation ourselves.

## Decision

Use the pinned Nitro v3 Vite plugin in the docs example to build the `client` and `ssr` environments
and package them through Nitro's Vercel preset. The existing Vidact Start compiler plugins continue
to select hydration and server code generation by those environment names.

The docs SSR entry exposes `{ fetch: handler }`. Vidact Start owns route matching, loaders, HTML,
and navigation snapshots. Nitro owns host adaptation, deployment output, and static delivery.
This extends the host-adapter boundary in [Vidact Start file-route lifecycle](vidact-start-file-route-lifecycle.md)
without adding a public Nitro dependency to `@vidact/start`.

## Invariants

- Submodule preparation and workspace compilation run before the deployment build.
- Deployment files run without the source checkout or workspace dependencies.
- Static assets take precedence over the SSR fallback.
- Stable asset filenames require cache revalidation across deployments.
- The docs use Shiki's JavaScript engine; Nitro's native WASM export conditions are disabled.
- Page status codes, HEAD responses, and navigation snapshots retain Vidact semantics.

## Alternatives considered

- **Custom Vercel output writer:** fewer dependencies, but duplicates Nitro's host packaging work.
- **Nitro as Vidact's router:** unnecessary; the standard Fetch interface preserves existing routes.

## Consequences

The example can use Nitro presets without changing rendering code. Nitro v3 is currently a beta
dependency, so its exact version and compatibility date are pinned and upgrades require running
the deployment test. Vercel is the tested target; other presets require their own verification.

## Verification

- [Nitro configuration](../../examples/docs/vite.nitro.config.ts)
- [Fetch entry](../../examples/docs/src/nitro.ts)
- [Deployment test](../../examples/docs/test/vercel-build.test.ts) builds and relocates the output,
  then checks landing and docs pages, navigation snapshots, HEAD, 404s, and asset cache rules.
- `pnpm --filter @vidact/example-docs build:vercel`
- `pnpm --filter @vidact/example-docs test:unit`
