# Retained Activity connections

- Decision state: Accepted
- Decided: 2026-08-23
- Superseded in part by: [Capability-owned runtime entrypoints](capability-owned-runtime-entrypoints.md)
- Amends: [Compiled lifecycle effects and commit phases](compiled-lifecycle-effects-and-commit-phases.md)
- Amends: [Owned external-store snapshots](owned-external-store-snapshots.md)

## Context

React 19.2 `Activity` hides a subtree without replacing it. Local state and DOM
identity survive, Effects and subscriptions disconnect while hidden, work in the
hidden tree runs at lower priority, and restoring the tree recreates Effects.
Ordinary compiled conditionals cannot provide this contract because disposing a
branch also disposes its scopes, state, nodes, and ownership ranges.

The boundary also has to compose with wrapper-free compiled output. An Activity
may own one host element, multiple component ranges, or text alone, so inserting
a permanent wrapper would change HTML semantics and CSS layout.

## Decision

`Activity` is available only with the `retained-ui` compiler feature. The
compiler recognizes semantic `react` imports, requires a `mode` prop, and stages
children in a generated render factory. Without the feature, the element fails
at its original source span. The Vite facade exposes `Activity` from the
target-specific `@vidact/runtime/retained-ui` entry only when enabled.

Each Activity owns a retained connection beneath its logical owner. Descendant
component scopes inherit the nearest connection, while nested Activities form a
connection tree. A connection's effective state is visible only when both it
and every ancestor are visible. Hiding walks resources in reverse construction
order; showing reconnects subscriptions before Effects and then propagates to
nested connections. An inner hidden Activity therefore stays disconnected when
an outer Activity becomes visible.

Layout, insertion, and passive Effects register connect/disconnect resources
when retained UI is enabled. Disconnect runs the current cleanup and invalidates
pending passive work. Reconnect evaluates the latest compiled dependency
snapshot and recreates the Effect without reconstructing its component.
`useSyncExternalStore` uses an earlier connection phase: it unsubscribes while
hidden, resubscribes on reveal, and rechecks the snapshot before dependent work
settles.

State writes still update their slots immediately. Scope invalidation inside a
hidden connection is queued through the deferred scheduler. Before a hidden
flush returns, the owning Activity reapplies concealment to any newly published
top-level nodes. Revealing a connection promotes any remaining deferred flushes
back to the normal compiled queue.

Host-element roots remain in the document and receive an important inline
`display: none`; their prior inline display value and priority are restored on
reveal. Top-level text nodes move to a detached fragment behind stable comment
positions, so text-only Activities have no visible output while retaining the
same `Text` identity and accepting hidden updates. No permanent wrapper is
introduced.

The server serializes initially hidden host roots with
`display:none!important` as the final inline declaration. During the initial
hydration claim, the client parses the preceding authored style in a detached
element and remembers its display value. Hydration claims the same nodes with
zero mutations; reveal restores the authored value without private attributes
that could collide with application data.

The retained entry activates lifecycle paths when `Activity` is first called,
before its staged descendants construct scopes or Effects. The Vite adapter
defines `__VIDACT_RETAINED_UI__` as false so entrypoint reachability, rather than
an app-wide true constant, controls tree shaking. Builds that never import
`Activity` erase the activation function, connection tuple field, deferred
scheduler path, resource branches, and retained entry. Direct consumers of
`@vidact/runtime/retained-ui` receive the same activation semantics.

## Invariants

- Hiding never disposes a compiled scope, state slot, owned DOM range, or node.
- Hidden Effects and external-store subscriptions are disconnected exactly once
  per visibility change and use their latest values when reconnected.
- Hidden invalidations are deferred; they may update retained DOM but cannot
  make the boundary visible.
- Nested visibility is conjunctive: a child connects only when it and every
  retained ancestor are visible.
- Visible restoration preserves host and text node identity.
- Initially hidden SSR output is deterministic and hydration claims it without
  remounting or recoverable errors.
- Authored inline display state survives a server-hidden hydration round trip.
- Initially hidden server output requires a host-element root. The server
  rejects non-empty top-level text rather than leaking it or adding a
  hydration-only wrapper; client-only text Activities remain supported.
- A build without `retained-ui` contains no retained connection machinery.

## Consequences

The feature deliberately uses inline `display` ownership while hidden. Code
that mutates the same top-level element's inline `display` outside Vidact during
the hidden interval races with the Activity owner; compiled style updates are
observed and become the value restored on reveal.

Server-hidden markup keeps authored display declarations before the final
important hidden declaration. The retained hydration style path compares the
authored declarations without mutating the live node, so reveal can restore
them without private attributes or hydration churn.

An enabled but unused `retained-ui` feature produces the exact default counter
artifact. Calling `Activity` activates connection-aware scopes and Effects for
the staged descendant graph.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers exact feature gates,
  reactive mode lowering, and staged children.
- `crates/vidact-compiler/tests/server_codegen.rs` covers server gating and child
  factories.
- `packages/runtime/test/lifecycle/activity.browser.test.ts` covers DOM/state
  identity, Effect disconnect/reconnect, deferred hidden work, and text-only
  retention in Chromium, Firefox, and WebKit.
- `packages/runtime/test/server/server.test.tsx` covers deterministic hidden
  styles, authored display preservation, and the server text-root boundary.
- `tests/browser/corpus/retained-ui` proves the contract through React-shaped
  compiler output, including external-store subscription ownership and mutation
  envelopes in three engines.
- `tests/browser/corpus/retained-ui-hydration` proves zero-churn adoption and
  same-node reveal from initially hidden server markup.
- `tests/runtime-size/measure.mjs` measures an 8,064-byte enabled-unused artifact
  identical to default and a 10,014-byte representative Activity artifact.
