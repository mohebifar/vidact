# Vidact documentation website

The user documentation for Vidact, built with Vidact Start, Fumadocs Core, and Tailwind CSS. Fumadocs
supplies the headless page tree and document lookup; the application shell and every component on the
page compile to Vidact without Fumadocs UI, Base UI, or React interop.

Documentation lives in `content/docs/**/*.mdx` and is organized the way React's and Solid's docs are:

- **Getting started**: introduction, quick start, installation.
- **Learn**: one concept per page, from "components run once" through state, events, forms, lists,
  effects, refs, context, error handling, and opt-in features.
- **Vidact Start**: the full-stack layer, from first route to deployment.
- **Guides**: migrating from React, testing, troubleshooting.
- **Reference**: each package's API, plus the React compatibility table.
- **Under the hood**: how compilation, reactivity, ownership, and server rendering work.

Page order within each section is defined in `src/lib/source.server.ts`.

## Search and WebMCP

Search opens from either header, **⌘K** on macOS, or **Ctrl+K** on other platforms. Arrow keys
select a result, Enter opens it, and Escape closes the dialog and restores focus. The dialog
uses Vidact components and a native modal `<dialog>`. Fumadocs Core indexes page titles,
headings, prose, and code on the server through `/api/search?query=...`. Heading IDs come from
the same parsed content used to render pages. The search engine and index stay out of the
client bundle.

Browsers that expose [`document.modelContext`](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
receive three WebMCP tools after hydration:

- `search_docs({ query })` returns matching text and documentation paths.
- `read_doc({ path })` returns page sections and code without navigating.
- `open_doc({ path })` navigates this tab to a published page or heading.

The tools share the website's content and search APIs. Reads accept only published `/docs`
paths; they cannot fetch arbitrary URLs or files. Fetches honor tool cancellation, and an
aborted registration signal removes the tools on page exit or hot replacement. Registration
failure does not interrupt hydration. WebMCP is an experimental browser API: unsupported
browsers retain normal search and navigation, with no polyfill or agent service required.

Run `pnpm test` for endpoint, deployment-bundle, WebMCP lifecycle, and search interaction tests.

## Authoring

Each page starts with `title`, `description`, and `group` frontmatter. Content before the first `##`
heading is the page introduction. The server parses MDX into serializable blocks and highlights code
with a narrowly configured Shiki instance; the browser renders those blocks with Vidact components.

Supported Markdown: paragraphs with inline code, bold, italics, and links; `##` and `###` headings;
ordered and unordered lists; tables; fenced code with an optional `title="..."`; and GitHub-style
callouts (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, optionally followed by a title on the same line).
Links that start with `/` use client-side navigation.

`<Preview variant="counter" />`, `toggle`, and `list` embed live compiled components.

## Development

```sh
pnpm --filter @vidact/example-docs dev
```

The development server listens on `http://127.0.0.1:5173` by default.

### Landing page measurements

The landing page shows total gzipped JavaScript for two production builds, including the runtime.
Run `pnpm size` from the repository root after building the workspace packages to refresh them.
The September 6, 2026 measurements were 8,143 bytes for
`tests/runtime-size/fixtures/counter.tsx` and 11,943 bytes for `examples/todomvc/src/TodoApp.tsx`.
The page rounds these to decimal kB. Keep measurement dates, source paths, and reproduction
instructions here rather than in visitor-facing copy.

## Vercel deployment

Set the Vercel project's Root Directory to `examples/docs` and enable
[source files outside the Root Directory](https://vercel.com/docs/monorepos/monorepo-faq).
Select Node.js 24.x. The local `vercel.json` selects the Other framework preset and sets the build
command to:

```sh
bash ../../scripts/prepare-oxc.sh && pnpm --workspace-root build:packages && pnpm build:vercel
```

Vercel runs this command from `examples/docs`. The preparation script initializes the pinned
`vendor/oxc` submodule and applies `patches/oxc/*.patch`. It can also run when the complete patch
series is already applied. The patches are maintained with `git-go-patch`; build environments
apply them with `git apply` through this script, so they do not need Go or `git-go-patch` installed.

`--workspace-root` selects the repository's `build:packages` script. Running `pnpm build:packages`
without that flag fails because this package does not define that script. Building the workspace
compiler also requires the pinned Rust toolchain described in the [repository README](../../README.md).

`build:vercel` uses the pinned Nitro v3 Vite plugin in `vite.nitro.config.ts` to build the client and
SSR environments, then emits the [Vercel preset](https://nitro.build/deploy/providers/vercel) output
under `.vercel/output`:

- `static/` contains the client JavaScript, CSS, and assets served by Vercel.
- `functions/__server.func/` contains the bundled SSR handler and Node.js 24 runtime configuration.
- `config.json` serves existing static files first, then sends page requests to the SSR function.

`src/nitro.ts` exposes the existing Vidact Fetch handler to Nitro. Vidact still owns route matching,
loaders, SSR, and navigation snapshots; Nitro owns deployment packaging and static asset delivery.
The bundle includes runtime dependencies and MDX content, so it does not need the source checkout
or native compiler at request time. This integration is local to the docs example, and its Nitro
beta version is pinned. Other Nitro targets can be selected through `NITRO_PRESET`.

Nitro's WASM handling is disabled because the docs use Shiki's JavaScript engine. The `/assets/**`
cache policy requires revalidation because the current client build uses stable filenames.

Leave the Output Directory override unset: Vercel consumes `.vercel/output` directly. The ordinary
`pnpm build` still produces `dist/client` and `dist/server/start.js` for `pnpm preview`; that standalone
server output alone does not register a function on Vercel.

Run `pnpm test:unit` to verify the deployment bundle from a temporary directory with no workspace
dependencies, including landing and docs pages, navigation snapshots, HEAD requests, and 404s.
