# Headless Fumadocs content boundary

- Decision state: Accepted
- Decided: 2026-08-28
- Builds on: [Vidact Start file-route lifecycle](vidact-start-file-route-lifecycle.md)
- Builds on: [shadcn Base UI as a compatibility corpus](shadcn-base-ui-compatibility-corpus.md)

## Context

Vidact needs a useful documentation starter without adopting the renderer,
component ownership, or client runtime expected by `fumadocs-ui`. Treating
Fumadocs only as visual inspiration would also discard its useful content-source
and page-tree APIs.

The generated Fumadocs server adapter retains optional renderer-oriented code.
Importing that adapter into the Vidact production graph would make a data-only
integration look renderer-coupled even when the application needs only page
metadata, URLs, ordering, and raw authored Markdown.

## Decision

`examples/docs` uses Fumadocs as a headless, server-only content system and uses
Vidact Start as the application framework. `fumadocs-mdx` transforms collection
frontmatter during the Vite build. The docs source constructs a Fumadocs
`StaticSource` from transformed frontmatter, raw Markdown, and metadata files,
then uses `fumadocs-core/source` to derive canonical URLs and page-tree order.

Route loaders convert each selected page into a closed, serializable view model:
navigation records, headings, table-of-contents entries, paragraphs, lists,
quotes, code blocks, separators, and the shadcn support matrix. Vidact Start
places only that data in its server snapshot. Local compiled TSX renders the
shell and page; no MDX component function, React element descriptor, or
Fumadocs UI component crosses the boundary.

The Markdown conversion is intentionally bounded. Arbitrary MDX JSX, dynamic
imports, and renderer plugins are not silently accepted. Adding another syntax
form requires an explicit serializable block and a local Vidact renderer.

## Compiler and runtime contract

- Fumadocs source and MDX packages execute only in the SSR/build environment.
  The client loader branch consumes the Start snapshot and does not import the
  content source.
- The Vite configuration excludes Fumadocs package source from Vidact component
  lowering because those packages are data providers, not component owners.
- Route components pass `loaderData`, `params`, `requestUrl`, and owned children
  explicitly. Reactive component spreads may not smuggle `children` or `key`
  across the route boundary.
- The client and server builds use Vidact's target-specific JSX runtimes. The
  production verifier scans both outputs and rejects a retained React runtime,
  React DOM renderer, React element tag, or compatibility adapter.
- Missing content throws a Web `Response` with status `404`, which Vidact Start
  preserves as the route response.

## Invariants

- Fumadocs owns content discovery, metadata normalization, canonical docs URLs,
  and page-tree ordering; it never owns browser nodes.
- Vidact Start owns request routing, server rendering, serialization, hydration,
  and same-document navigation.
- Loader snapshots contain only values accepted by the framework serializer.
- Every browser node belongs to a compiled Vidact owner or an explicitly owned
  portal interval.
- `fumadocs-ui` is absent from the dependency graph.
- A production build fails if any emitted JavaScript retains a React renderer or
  compatibility path.
- Compile-only shadcn modules are not presented as interaction-certified.

## Alternatives considered

- **Compile `fumadocs-ui`:** rejected because its renderer-facing component
  graph is not a portability contract and would pressure Vidact toward React
  replay or a second owner system.
- **Use only Fumadocs-generated server modules:** rejected because the generated
  adapter retains optional Markdown-rendering code that is outside this
  data-only boundary.
- **Render arbitrary MDX on the client:** rejected because executable component
  values do not fit the closed Start snapshot and would make ownership depend on
  renderer interop.
- **Reimplement page ordering and URLs locally:** rejected because Fumadocs
  already provides those headless content semantics without owning the UI.

## Consequences

The starter has real Fumadocs-backed content organization and a fully Vidact-
owned browser surface. Content authors get MDX files and metadata ordering, while
the production application remains React-free and can progressively enhance
ordinary links through Vidact Start.

The tradeoff is a smaller authoring language than a general MDX renderer.
Custom JSX components, rich Markdown extensions, search indexing, and static
generation require explicit Vidact-native data and ownership contracts before
they can be added.

## Verification

- `examples/docs/test/server.test.ts` proves SSR for the docs index and component
  page, navigation snapshots, and a loader-backed `404`.
- `examples/docs/src/App.browser.test.ts` proves surgical navigation filtering,
  theme updates, and mobile navigation while retaining stable page owners.
- `examples/docs/src/ComponentShowcase.browser.test.ts` mounts the integrated
  component page showcase and operates only interaction-certified controls.
- `examples/docs/src/ShadcnExpansionProof.browser.test.ts` and
  `examples/docs/src/PopoverProof.browser.test.ts` prove the published Base UI
  Collapsible and local owner-aware Popover behavior.
- `examples/docs/scripts/audit-shadcn-compatibility.mjs` classifies all 61 copied
  registry modules.
- `examples/docs/scripts/verify-production-bundle.mjs` scans the client and
  server output for retained React runtime paths.
- `pnpm --filter @vidact/example-docs test`
- `pnpm --filter @vidact/example-docs build`
- `pnpm --filter @vidact/example-docs audit:shadcn`
