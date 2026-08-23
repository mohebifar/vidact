# Versioned compiler targets and feature gates

- Decision state: Accepted
- Decided: 2026-08-23
- Supersedes in part: [Opaque raw HTML subtrees](opaque-raw-html-subtrees.md)
- Amends: [Component spans and compatibility corpus](component-spans-and-compatibility-corpus.md)

## Context

Vidact's Vite plugin and compiler process previously exchanged generated code
without a versioned compatibility boundary. Build targets and feature names
could be accepted by the command line while having no effect on compilation,
and the plugin cache did not prove that compiler/runtime ABI or configuration
matched a cached result. Generated source maps also began at compiler output,
so browser diagnostics could not reliably map through the TypeScript transform
to original TSX.

Some React-shaped APIs deliberately need explicit opt-in semantics. In
particular, `dangerouslySetInnerHTML` is an injection sink and an opaque
ownership boundary. Treating an accepted feature name as documentation-only
would silently enable behavior the application had not selected.

## Decision

The compiler has typed, closed sets for build targets and semantic features.
The targets are `client`, `hydrate`, and `server`. The features are
`unsafe-html`, `async`, `concurrent`, `actions`, `css-insertion`, `retained-ui`,
`profiling`, and `framework`. Unknown values fail before compilation.

Compilation receives one immutable `CompilationOptions` value. The command-line
client, Vite plugin, compatibility corpus, and direct Rust callers use that same
configuration path. A feature may be named before its implementation exists,
but it must not change source semantics until the compiler explicitly consumes
it.

`dangerouslySetInnerHTML` is disabled by default. A source module using the JSX
attribute without `unsafe-html` fails with `UnsupportedSyntax` at the exact
attribute span. Enabling the feature activates the existing opaque raw HTML
compiler/runtime contract; it does not weaken that contract's validation,
transaction, ownership, or Trusted Types rules.

The process protocol is `vidact-compile-v2` and includes generated code, its
source map, compilation metadata, and the effective target/features. The
runtime publishes `vidact-runtime-v1` through `@vidact/runtime/protocol`. The
Vite compiler client checks both constants against the installed packages
before accepting output.

Rust code generation emits an original-TSX source map. Vite passes that map as
the input map to its TypeScript transform so the final map composes both stages.
The plugin's memory-cache key fingerprints source, filename, environment,
target, sorted features, compiler protocol, runtime protocol, and compiler
manifest. A cached result therefore cannot cross a semantic configuration or
known ABI boundary.

The Vite configuration also publishes compile-time runtime feature constants.
When `unsafe-html` is absent, raw-HTML branches and their imported implementation
are unreachable and disappear from the final chunk. Standalone runtime tests
and non-Vite consumers default the constant to enabled so direct runtime usage
does not silently change; compiled applications receive the explicit plugin
configuration.

## Invariants

- Unknown target or feature names never compile under default behavior.
- Configuration reported in compiler output exactly matches configuration used
  for lowering.
- Disabled opt-in syntax fails at its original TSX site.
- Cache identity changes whenever source semantics, environment, compiler
  artifact, or compiler/runtime protocol can change.
- Browser source locations compose back to the original TSX rather than an
  intermediate generated module.
- Merely declaring an unused feature adds no generated application behavior.

## Consequences

Compiler targets and features are now real build inputs rather than permissive
metadata. Implementing another gated family requires a compiler-side semantic
check and compatibility fixtures for both disabled and enabled behavior.

`unsafe-html`, `css-insertion`, `async`, `concurrent`, `actions`, `retained-ui`,
and `profiling` now consume feature flags. Async
selects isolated client, hydrate, and server entries and enables compiler-owned
Suspense factories, resource reads, and lazy module records. Actions selects
its form and state entries; retained UI selects the Activity facade, whose first
call activates lifecycle, server-style, and deferred-hidden-work paths before
its staged descendants are constructed. An enabled but unused retained feature
therefore produces the exact default artifact. Profiling selects staged
Profiler boundaries, reactive debug values, logical owner stacks, and
development-only performance tracks. Its entrypoint-driven activation also
preserves an exact default artifact when enabled but unused. The other accepted
names remain reserved configuration values whose syntax is unsupported;
transporting them does not claim runtime parity. `hydrate` and `server` now
select implemented hydration and SSR lowering targets.

The `unsafe-html` implementation is absent from chunks built without the
feature. Forms, styles, namespaces, events, and refs still share the default DOM
runtime, so extending capability reachability to those families remains a
separate size project under the compact ABI decision.

Protocol constants are intentionally explicit rather than inferred from
package versions. Any incompatible payload or runtime ABI change must bump the
appropriate constant and add/update a boundary test.

## Alternatives considered

- **Accept configuration only in the CLI:** keeps the Rust API smaller but lets
  direct callers and tests bypass the same semantic contract.
- **Use package versions as protocol versions:** couples compatibility to
  unrelated releases and cannot express a local compiler artifact mismatch.
- **Cache by source text only:** fast and simple, but can reuse code across
  targets, feature sets, environments, or compiler/runtime ABI changes.
- **Enable raw HTML by default:** matches the earlier implementation but makes
  an injection sink and ownership escape hatch implicit.
- **Emit only the final TypeScript transform map:** maps failures to generated
  code rather than the React-shaped TSX authors maintain.

## Verification

- `crates/vidact-compiler/tests/compatibility_corpus.rs`
- `crates/vidact-compiler/tests/fixtures/compatibility/manifest.json`
- `crates/vidact-compiler/tests/fixtures/compatibility/rejected/raw-html-disabled.tsx`
- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/vidactc.rs`
- `packages/vite-plugin/test/compiler-client.test.ts`
- `packages/vite-plugin/test/plugin.test.ts`
- `tests/browser/corpus/apps/raw-html/RawHtmlApp.browser.test.ts`
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/vite-plugin test`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
