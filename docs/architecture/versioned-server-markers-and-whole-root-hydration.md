# Versioned server markers and whole-root hydration

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Vidact must render deterministic HTML without importing browser globals and
hydrate that output without introducing an element tree or replaying component
functions after mount. Server and browser compilation still need to agree on
component ownership, text ranges, root identity, and `useId` allocation even
though their runtimes perform different work.

Hydration is also a protocol boundary. Markup may have been produced by a
different compiler/runtime release, modified by an intermediary, or initialized
with data that differs from the client. Treating arbitrary existing DOM as a
successful match would attach updater closures to the wrong nodes.

## Decision

Server compilation uses React Compiler's SSR optimization behind the same
Vidact semantic analysis and compatibility validation used by client lowering.
It retains the analyzed `ComponentIr` in the compile result while emitting JSX
for the browser-free `@vidact/runtime/server` entry point. Client-only effect
work is removed; initial state, server snapshots, context, and IDs execute in a
lazy synchronous server-render request.

`renderToString` emits a versioned `vidact:v1` comment protocol. A root range
contains nested component ranges, and scalar child slots use text ranges. The
comments are ownership and claiming metadata, not a serialized React element
tree. `renderToStaticMarkup` deliberately omits them and is therefore not
hydratable.

The hydrate compiler target imports `@vidact/runtime/hydrate`, including its
own automatic JSX entry points. `hydrateRoot` synchronously validates the root
protocol, constructs the ordinary compiled scopes once, and claims existing
elements, component ranges, and scalar text. Matching content preserves node
identity and performs no initial DOM insert, removal, or text replacement.
After claiming, the same static source-mask updaters used by a client-only root
own all subsequent updates and disposal.

Root identity uses the same `:${identifierPrefix}r${ordinal}:` allocation on the
server and hydrate targets. The identifier prefix is part of the render/root
input, and allocation is request/root local.

A missing marker, unsupported protocol version, tag/namespace mismatch, text
mismatch, or unclaimable range raises a hydration mismatch. The mismatch is
reported through `onRecoverableError`; the current defined recovery boundary is
the whole Vidact root. Recovery mounts a fresh client root inside that host and
does not affect neighboring DOM outside it. Application errors continue through
the ordinary caught/uncaught error channels and are not mislabeled as hydration
mismatches.

Structural branch and collection markers extend this same protocol. Until a
structural kind has a symmetric server emitter and hydrate claimant, encountering
it must recover at the root boundary rather than partially adopting its DOM.

## Invariants

- Server entry points do not read `window`, `document`, `Node`, or other browser
  globals.
- Server text and attribute values are escaped before entering trusted emitted
  markup; raw HTML remains gated by the `unsafe-html` compiler feature.
- Hydratable and static markup are distinct APIs.
- Marker versions participate in compiler/runtime compatibility and cannot be
  accepted optimistically across unknown versions.
- A successful hydration retains existing node identity and leaves updater,
  owner, cleanup, context, error, ref, and ID behavior on the ordinary compiled
  runtime path.
- A failed claim disposes partial owners before whole-root recovery.
- Client-only builds do not import server serialization or hydrate claiming
  entry points.

## Alternatives considered

- **Render through React DOM Server:** would ship a React runtime and element
  tree, contradicting Vidact's compiler/runtime boundary.
- **Rebuild and diff a detached client tree:** cannot transfer event, ref, and
  updater closures safely and produces avoidable DOM churn.
- **Claim by tag name without markers:** is ambiguous for repeated and nested
  structures and can silently attach updates to the wrong node.
- **Accept markerless static HTML:** makes protocol skew and empty/dynamic text
  impossible to distinguish soundly.
- **Recover individual arbitrary nodes immediately:** risks leaving one logical
  owner split across server and client ranges. Whole-root recovery is the first
  safe boundary; narrower owned-range recovery can be added when every resource
  under that range is transactionally staged.

## Consequences

Hydratable output is slightly larger than static output because it carries
versioned comments. Applications that only prerender immutable pages can use
`renderToStaticMarkup`; interactive roots pay only for the markers and hydrate
entry point they select.

The server serializer evaluates components lazily during the render request.
That ordering is required for nested context providers and request-local IDs,
and it avoids global JSX-construction state before `renderToString` begins.

Adding structural hydration is constrained but straightforward: server and
hydrate implementations must introduce the same versioned range kind, prove
initial identity reconstruction, and add zero-churn plus mismatch-recovery
fixtures before the claimant is enabled.

## Verification

- `crates/vidact-compiler/tests/server_codegen.rs` covers SSR optimization,
  shared analyzed IR, source maps, and server feature diagnostics.
- `packages/runtime/test/server/server.test.tsx` covers deterministic escaping,
  static versus hydratable output, context, state, server snapshots, and IDs
  without browser globals.
- `packages/runtime/test/lifecycle/root.browser.test.ts` proves matching element
  and text identity, a zero-mutation hydration envelope, post-hydration surgical
  state updates, ID parity, mismatch recovery, version skew, and disposal.
- `packages/vite-plugin/test/compiler-client.test.ts` covers isolated server and
  hydrate compiler targets and runtime imports.
