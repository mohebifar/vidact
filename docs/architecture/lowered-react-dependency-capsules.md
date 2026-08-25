# Lowered React dependency capsules

- Decision state: Accepted
- Decided: 2026-08-24
- Amends: [React analysis boundary](react-analysis-boundary.md)
- Amends: [Owned component result ranges](owned-component-result-ranges.md)

## Context

React component libraries commonly publish JavaScript rather than their original
JSX or TSX. Their package entries may contain automatic-runtime `jsx` calls,
classic `createElement` calls, minified hook names, re-export graphs, and
element-valued or callback render props. Vite previously skipped `node_modules`,
so an application could compile while a reachable dependency still expected the
React runtime and React element descriptors.

Treating every package that mentions React as source would compile unreachable
code, destabilize dependency optimization, and turn package names into an
implicit compatibility list. Falling back to React for code Vidact cannot lower
would add a second renderer and break Vidact's ownership model. Vidact instead
needs a deterministic way to select only reachable package entries, reconstruct
an analyzable module, and reject constructs outside its source subset before
they reach the browser.

## Decision

The Vite plugin automatically considers a resolved, reachable `node_modules`
module a dependency-compilation candidate when its owning package declares
`react` or `react-dom` in `dependencies`, `peerDependencies`, or
`optionalDependencies`. Qualification follows the resolved real path back to
the owning manifest, including pnpm virtual-store and linked-package layouts;
it does not scan the install tree or key behavior to a package name.

`includeDependencies` is a discovery override for compatible packages without
React metadata. The general `exclude` filter wins before dependency
qualification and leaves matching files untouched. These options are explicit
escape hatches, not the ordinary way Base UI is selected.

For each reachable qualified module, Vite builds one deterministic ESM
dependency capsule for the current target, feature set, environment, and define
set. The capsule:

- starts at the resolved package entry and tree-shakes its reachable graph;
- inlines other qualified React-bearing package modules;
- keeps ordinary packages, `react`, `react-dom`, and Node built-ins external;
- emits exactly one chunk and an accompanying source map;
- records every module and package manifest that contributed to the capsule;
- fingerprints the code, map, manifest, target, features, environment, and
  defines for compilation caching; and
- registers contributors with Vite so HMR invalidates only affected capsules.

Vite disables automatic dependency discovery by default and defaults SSR to
`noExternal: true`. User-supplied `optimizeDeps.noDiscovery` and
`ssr.noExternal` values remain authoritative. This keeps qualified entries on
the Vidact transform path for client, hydration, development, production, and
server builds instead of letting an optimizer make an opaque prebundle first.

The capsule is compiled with the internal `dependency-source` feature. The
Rust compiler first normalizes supported lowered React factories back into the
same JSX-shaped semantic input used by ordinary source:

- automatic `jsx`, `jsxs`, and `jsxDEV`, including direct aliases and namespace
  member calls;
- classic `createElement` through named, namespace, and default React imports;
- bounded `memo` and `forwardRef` wrappers; and
- named, aliased, and namespace React hook imports used by the supported Vidact
  subset.

Minification is not itself a compatibility boundary. A minifier may shorten
local import names and whitespace, and Vidact still identifies the factory or
hook by the imported module and semantic symbol. A transform that copies a
factory into an untracked value, converts the module into an opaque runtime
loader, or otherwise erases import provenance is rejected. Vidact does not guess
from identifier spelling, object shape, or minified source text.

Dependency compilation has no React runtime fallback. A failure is reported as
`Cannot compile React dependency`, with package name and version, resolved
entry, compilation target, the underlying unsupported construct and span, and
an original package-source location when the capsule map can recover it.

## Compiler and runtime contract

Element-valued render props use a bounded compiled-renderable capability. The
runtime value carries a non-enumerable `Symbol.for('vidact.v1.Renderable')`
brand, a live read-only props view, the original props input, and a
compiler-selected constructor that can materialize that one known intrinsic or
component site. Supported `createElement`, `cloneElement`, `isValidElement`, and
the single-renderable `Children.toArray` patterns lower to this capability.
Callback-valued render props remain ordinary callbacks returning compiled
values.

This capability is not a React element descriptor. It provides no public type,
key, owner, or arbitrary child-tree inspection; no reusable element tree; no
general traversal; no reconciler; and no API that reruns a component body. A
renderable can merge reactive authored and override inputs from at most two
compiled scopes. Materialized results enter the existing single-mount owned
range protocol, so their DOM, refs, effects, subscriptions, and prop bridges
are disposed with the logical owner that published them.

Dependency-generated bindings use the same owner and transaction machinery as
application source. Root replacement and Vite HMR dispose the old owner before
publishing its replacement, while contributor invalidation rebuilds the
capsule. No dependency-specific owner or persistent React object graph exists.

The first published compatibility proof is `@base-ui/react` 1.7.0. Its Button,
Input, and Toggle Group entries compile through the general qualifier,
capsule, normalizer, and runtime capability paths for client and server targets.
The shop uses shadcn's Lyra/Neutral components backed by those published Base UI
entries. Base UI is evidence for this contract, not a named adapter or compiler
special case.

## Invariants

- Only resolved modules reached by Vite are qualified; package metadata never
  triggers an install-wide scan.
- Qualification identity comes from the real module path and matching owning
  manifest, including scoped, pnpm, and symlinked packages.
- Package names do not select compiler behavior.
- One capsule contains one static entry graph and one source map; dynamic
  package graphs fail before Vidact compilation.
- Cache keys separate client, hydration, server, feature, environment, define,
  compiler-protocol, and runtime-protocol inputs.
- Every capsule contributor participates in Vite watch invalidation.
- Supported minified factories and hooks are recognized by import and semantic
  identity, never by their shortened local names.
- Lost React provenance and unsupported constructs fail during compilation;
  production output never falls back to React.
- A compiled renderable can materialize only its compiler-selected site and
  cannot become a general React element tree.
- Dependency-owned resources return to their prior owner count after root or
  HMR disposal.

## Alternatives considered

- **Scan every installed package with a React dependency:** finds code that may
  never be bundled, adds install-layout work, and confuses package metadata with
  reachability.
- **Maintain a Base UI or package-name allowlist:** hides the semantic boundary,
  becomes stale across versions, and cannot explain why a construct fails.
- **Compile each dependency module independently:** loses the import provenance
  and cross-module custom-hook context that the compiler needs for published
  graphs.
- **Run React Compiler directly on opaque minified bundles:** minification is
  workable only while module and symbol provenance remains; guessing after it
  is erased would accept programs Vidact cannot soundly own.
- **Interpret React element descriptors at runtime:** would require a second
  element-tree representation, reconciliation, and component replay.
- **Bundle React as a compatibility fallback:** creates two ownership systems,
  makes disposal and hydration ambiguous, and violates React-free production
  output.

## Consequences

Compatible published packages can now participate in Vidact without shipping
React or requiring application-local wrappers. The cost is an additional
per-entry bundling pass and a deliberately smaller accepted surface than a React
renderer. Capsule source maps and contributor-aware caches are required parts of
the feature rather than optional tooling polish.

The current compiler does not make every local derived from reactive props live.
In particular, a dependency component that destructures a dynamic prop into a
plain body local and later reads that local may retain its construction-time
value. Compatible library paths must keep the value in a compiler-tracked prop,
binding, or supported derived form. The shop uses only proven Base UI paths and
an explicit imperative disabled-state bridge where this limitation applies.
Reactive body-local destructuring remains compiler follow-up work.

TanStack Start is not part of this decision. Framework routing, server-module
conditions, streaming, and continuation ownership require a separate framework
integration after the dependency capsule contract is stable.

## Verification

- [`packages/vite-plugin/test/dependency-qualification.test.ts`](../../packages/vite-plugin/test/dependency-qualification.test.ts)
  proves metadata qualification, reachability, overrides, pnpm/symlink identity,
  and package-aware diagnostics.
- [`packages/vite-plugin/test/dependency-capsule.test.ts`](../../packages/vite-plugin/test/dependency-capsule.test.ts)
  proves graph flattening, externals, cache separation, contributor invalidation,
  source maps, and React-free development/production output.
- [`crates/vidact-compiler/tests/lowered_react.rs`](../../crates/vidact-compiler/tests/lowered_react.rs)
  proves minified aliases, automatic/development/classic factories, wrappers,
  and fail-closed provenance.
- [`packages/vite-plugin/test/base-ui.integration.test.ts`](../../packages/vite-plugin/test/base-ui.integration.test.ts)
  compiles published Button, Input, and Toggle Group entries for client and
  server, maps output to published source, and server-renders both render-prop
  forms without React.
- [`tests/browser/corpus/apps/base-ui-dependency/BaseUiDependencyApp.browser.test.ts`](../../tests/browser/corpus/apps/base-ui-dependency/BaseUiDependencyApp.browser.test.ts)
  proves published merge/event behavior, retained nodes, a surgical text update,
  and terminal owner cleanup in Chromium, Firefox, and WebKit.
- [`examples/shop/src/ShopApp.browser.test.ts`](../../examples/shop/src/ShopApp.browser.test.ts)
  and the shop production smoke prove the shadcn/Base UI application path,
  SSR/hydration identity, disposal, and React-free production bundles.

Run `cargo test --workspace`, `pnpm --filter @vidact/vite test`,
`pnpm --dir tests/browser test`, `pnpm --dir examples/shop test`,
`pnpm --dir examples/shop build`, `pnpm --dir examples/shop verify:bundle`, and
`pnpm --dir examples/shop test:start`.
