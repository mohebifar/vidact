# Framework streaming, continuations, and trust boundaries

- Decision state: Accepted
- Decided: 2026-08-23
- Amends: [Versioned compiler targets and feature gates](versioned-compiler-targets-and-feature-gates.md)
- Builds on: [Staged async resources and Suspense](staged-async-resources-and-suspense.md)

## Context

React-shaped framework APIs combine several contracts that do not belong in an
ordinary browser component runtime: request caches, waiting server renders,
Web and Node streams, resumable static output, client-module references, Server
Functions, pre-hydration input, and document-head coordination. Importing those
capabilities through the default entry would violate Vidact's capability-
reachability rule. Treating React's private Flight or postponed-state formats
as public standards would instead couple Vidact to renderer internals it does
not implement.

Framework payloads are also a trust boundary. A checksum can detect accidental
corruption and protocol skew, but it cannot authenticate a payload whose sender
can recompute that checksum. Server Function identifiers must never become an
implicit path from serialized input to arbitrary code.

## Decision

The `framework` compiler feature enables a Vidact-owned integration contract,
not React renderer protocol equivalence. Client, hydrate, and server framework
entry points are isolated under `@vidact/runtime/framework`. Modules using
`"use client"` or `"use server"` are validated at the directive span. Server
cache APIs are rejected from browser targets, and framework resource APIs fail
at their call site when the feature is disabled.

Framework renders own one request-local cache, abort signal, pending-resource
set, and head registry. `cache` memoizes by function plus argument identity for
that request; `cacheSignal` exposes its lifetime signal. A render retries the
same request context until all registered resources settle or a bounded
stabilization limit is reached.

`renderToReadableStream` and `renderToPipeableStream` expose chunking,
cancellation, error callbacks, and destination backpressure. They deliberately
publish the settled document rather than React-style incremental boundary
instructions: the first render pass establishes shell readiness, but bytes wait
for the final resource-stable HTML. This preserves failure-atomic owned ranges
without introducing a browser instruction interpreter.

`prerender` and `prerenderToNodeStream` retain the first fallback-bearing shell
as the prelude and encode the settled document as a Vidact continuation.
`resume` and `resumeToPipeableStream` validate that continuation and publish its
final HTML. This is a Vidact continuation format, not React's postponed-state
format, and it cannot be exchanged with React implementations.

Server Component payloads use an explicit client-module manifest. Client
references encode only a module identifier and export name allowed by that
manifest. Server Functions use opaque identifiers and an application-created
registry; invocation can reach only identifiers explicitly registered in that
registry. The serializer supports a closed JSON-compatible value model,
preserves tag-shaped user objects without ambiguity, rejects cycles and unsafe
object keys, and carries an explicit framework protocol plus corruption
checksum.

The checksum is not a message authentication code. Applications and frameworks
remain responsible for authenticated transport, authorization, CSRF and origin
checks, replay policy, secret handling, and deciding which Server Functions to
register.

Framework hydration is an explicit independent-boundary operation. An event
queue captures a stable node path plus controlled input state before a selected
subtree hydrates, then replays supported native events after that boundary is
claimed. Vidact does not infer arbitrary Fiber islands or promise React's
selective-hydration scheduling.

Resource hints and eligible metadata are coordinated by the framework entry.
Server renders deduplicate and order head entries. Client metadata has logical
owner cleanup, last-owner precedence, reactive replacement, and restoration of
an existing unmanaged baseline. The compiler activates client metadata support
only for eligible HTML `title`, `meta`, `link`, precedence-bearing `style`, and
async external `script` JSX. SVG titles do not activate it. Enabling an unused
framework feature therefore retains the exact default client artifact.

## Compiler and runtime contract

- The compiler preserves framework directives but validates feature and target
  legality before lowering.
- Eligible metadata emits one module-level
  `__vidactEnableFrameworkMetadata()` call and imports generated helpers from
  the framework client or hydrate entry. Other modules retain their narrowest
  existing runtime entry.
- The framework entry is a tree-shakeable superset of async, concurrent, and
  Actions helpers because metadata may coexist with those compiler features.
- Server JSX uses the framework server JSX entry so resource and metadata
  registration share the active request context.
- Continuations and component payloads use `vidact-framework-v1`. Unknown
  protocols, invalid shapes, manifest misses, unsafe keys, cycles, and checksum
  mismatches fail before publication or invocation.
- The runtime never resolves a serialized module path or Server Function
  identifier by importing or evaluating it implicitly.

## Invariants

- Framework caches, abort signals, pending resources, and head state never leak
  across requests.
- A waiting or resumed render cannot publish after cancellation.
- Backpressured destinations receive the next chunk only after `drain`.
- Serialized user objects cannot collide with protocol tags.
- Client references are manifest-checked when a manifest is supplied, and
  Server Function calls reach only registered identifiers.
- A checksum failure is reported as corruption, never described as
  authentication.
- Framework metadata follows logical ownership and never hoists SVG metadata.
- Client-only modules that do not emit a framework helper do not retain the
  metadata or framework runtime.

## Alternatives considered

- **Implement React Flight and postponed-state formats:** those are tied to a
  renderer and framework ecosystem Vidact does not ship; claiming compatibility
  would be brittle and misleading.
- **Stream fallback HTML plus executable patch instructions:** this requires a
  browser instruction runtime and complex ownership transfer. Settled streaming
  keeps the current failure-atomic range model.
- **Hydrate arbitrary islands automatically:** without a framework-provided
  boundary and module manifest, ownership, code availability, and event routing
  are ambiguous.
- **Resolve Server Functions from serialized module paths:** serialized input
  would control executable code selection. An explicit allowlist registry keeps
  authority in application code.
- **Treat the payload checksum as security:** a non-secret checksum is useful
  for corruption detection but provides no authenticity or authorization.
- **Import metadata through the default DOM runtime:** tree shaking can retain
  reachable modules even when their code contributes no final bytes. A narrow
  installation hook preserves exact unused-feature reachability.

## Consequences

Framework adapters get stable, typed primitives for server waiting, streams,
static continuations, references, actions, head resources, and boundary
hydration without shipping React. They must build routing, transport security,
module loading, authorization, and progressive document patching above those
primitives.

The settled-stream contract favors correctness and a compact runtime over
React's earliest-byte behavior. A future incremental boundary protocol would
be a new versioned architecture decision, with symmetric server instructions,
client ownership adoption, CSP behavior, cancellation, and browser tests.

Tracked React Canary or experimental APIs—including `ViewTransition`, Fragment
refs, `browser()`, and `resumeAndPrerender` variants—remain outside this stable
contract.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/server_codegen.rs`
- `crates/vidact-compiler/tests/compatibility_corpus.rs`
- `packages/runtime/test/server/framework.test.tsx`
- `packages/runtime/test/reactivity/framework.browser.test.ts`
- `packages/vite-plugin/test/compiler-client.test.ts`
- `tests/browser/corpus/framework/FrameworkApp.browser.test.ts`
- `tests/browser/corpus/framework-hydration/FrameworkHydrationApp.browser.test.ts`
- `tests/runtime-size/measure.mjs`
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/runtime test`
- `pnpm --filter @vidact/vite test`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
