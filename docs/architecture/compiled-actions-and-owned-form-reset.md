# Compiled Actions and owned form reset

- Decision state: Accepted
- Decided: 2026-08-23

## Context

React 19 Actions join several observable contracts: `useActionState` serializes
async submissions, `useOptimistic` publishes urgent layers and later rebases
them, function-valued form props expose pending `FormData` through
`useFormStatus`, successful submissions reset form controls, and server output
can retain a permalink fallback before JavaScript loads. These operations must
compose with Vidact's static source masks and interruptible transaction lanes
without introducing component replay or a second form renderer.

Native `form.reset()` is not safe for compiled ownership. Firefox and WebKit
reset `<output>` by replacing its child nodes, which destroys binding markers
owned by Vidact even though the surrounding form stays mounted.

## Decision

The `actions` compiler feature lowers `useActionState`, `useOptimistic`, and
`useFormStatus` into source-mask slots. It also rewrites intrinsic forms to the
runtime-owned `ActionForm` component and wraps expression-valued `action` and
`formAction` props in the function-action bridge. Without the feature, hooks
and function form props fail at their original source spans; string URL actions
remain ordinary DOM attributes.

`useActionState` owns a FIFO queue. It invokes one action at a time with the
latest committed state, publishes pending state urgently while any entry is
queued, and commits each result through the transition scheduler. A dispatch
used as a form action returns a private completion promise so the form remains
pending until the queued entry settles. Direct dispatch failures route through
the captured compiled owner; form dispatch failures return to the form owner
for the same error-boundary and root-reporting path.

Action publication uses an independent transition lane. An unrelated user
transition therefore cannot discard a resolved action result. If urgent work
invalidates a staged slot before commit, the Action transaction retries with
the same result and optimistic frame before completing its queue entry.

`useOptimistic` stores ordered layers against an Action frame. Adding a layer
publishes its reduced value urgently. Action settlement marks all layers from
that frame inactive inside the result transition, recomputes against the new
passthrough value, and removes the layers only after atomic publication.
Canceled transition work restores the layers. An optimistic write outside an
Action or transition is rejected.

`ActionForm` owns one external status store. Deferred descendants constructed
inside the form subscribe to that nearest store through `useFormStatus`.
Submission selects a submitter `formAction` before the form `action`, creates
`FormData` with the submitter, reports method `post` for function Actions, and
keeps the exact action and data visible until settlement.
A URL-valued submitter override remains a native submission and bypasses the
form function Action. Overlapping submissions retain the latest status snapshot
and clear pending state or reset controls only after every active submission
settles.

Successful Actions reset uncontrolled inputs, textareas, and selects with an
owned reset routine, then restore compiler-controlled values. The routine does
not call native `form.reset()` and does not touch `<output>` children, preserving
compiled binding ranges and unrelated node identity. Failed Actions leave form
values unchanged.

Server hooks return deterministic initial values, false pending flags, and
dispatch functions that cannot run. When `useActionState` receives a permalink,
server serialization emits it as the escaped `action` or `formaction` URL for
progressive enhancement.

Actions use isolated `@vidact/runtime/actions` client, hydrate, and server
entries, with async compositions under `@vidact/runtime/async/actions`. They
reuse concurrent machinery internally, but public concurrent APIs remain
unavailable unless the separate `concurrent` feature is enabled. An unused
Actions opt-in tree-shakes to the exact default artifact.

## Invariants

- Action-state entries run sequentially and observe the previous committed
  result.
- Action results survive cancellation of unrelated user transition work.
- Pending state remains true until the complete action queue drains.
- Optimistic layers publish urgently and disappear only with a committed or
  canceled Action settlement.
- A reducer failure removes the layer it attempted to add before routing the
  Action error.
- A submitter function action overrides the form function action.
- A submitter URL action bypasses the form function action.
- Form status is scoped to descendants of the owning form and retains the
  submitted `FormData` identity while pending.
- Successful reset never destroys compiled output or binding markers; failed
  Actions never reset user input.
- Controls released from compiler control reset as uncontrolled fields.
- Function Actions are POST semantics, while server permalinks remain usable
  before client code loads.
- Default builds contain no Actions scheduler, form bridge, or status store.

## Consequences

The owned reset intentionally targets resettable field values rather than
delegating to the browser's blanket reset algorithm. This preserves Vidact's
DOM ownership and avoids browser-specific `<output>` churn. Code that depends
on programmatic native `reset` event dispatch should call `form.reset()`
explicitly outside Action completion and accept the native DOM semantics.
The proposed
[`no-action-reset-event-dependency`](../lint-rules/no-action-reset-event-dependency.md)
rule documents the source pattern that can accidentally rely on that difference.

Actions inherit Vidact's bounded transition model: user JavaScript before an
`await` runs synchronously, and publication can be canceled before its static
updaters begin rather than being arbitrarily time-sliced.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers lowering, source
  masks, form rewriting, and exact feature gates.
- `crates/vidact-compiler/tests/fixtures/compatibility` records accepted Actions
  syntax and disabled hook/form-action failures.
- `packages/runtime/test/actions/actions.browser.test.ts` covers FIFO queues,
  durable Action publication, optimistic rebase, status, overlapping
  submissions, submitter data, reset, controlled restoration, function and URL
  overrides, failures, node identity, and mutation envelopes in three browsers.
- `packages/runtime/test/server/server.test.tsx` covers deterministic server
  values and escaped permalink serialization.
- `tests/browser/corpus/actions/ActionsApp.browser.test.ts` compiles React-shaped
  TSX through Vite and proves surgical Action updates in Chromium, Firefox, and
  WebKit.
- `tests/browser/corpus/actions-hydration/ActionsHydrationApp.browser.test.ts`
  proves the same contract while adopting deterministic server markup.
- `tests/runtime-size/measure.mjs` enforces exact unused opt-in output and an
  11,446-byte gzip ceiling for the representative Actions app.
