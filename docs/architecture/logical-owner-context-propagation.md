# Logical owner context propagation

- Decision state: Accepted
- Decided: 2026-08-23

## Context

Vidact components construct once, component children are deferred until their
host namespace and logical parent are known, and dynamic branches or keyed rows
may construct descendants long after the provider's initial mount. A transient
global provider stack alone would therefore lose context for late descendants.

Context updates must also remain surgical. Reconstructing every descendant on
a provider change would discard retained state and violate Vidact's static
source-mask model.

## Decision

`createContext`, React 19 provider shorthand (`<Context value={...}>`), legacy
`<Context.Provider>`, `useContext`, and context-valued `use` share one logical
owner contract.

Each owner stores the immutable linked context frame active when the owner is
created. Provider blocks prepend a frame containing their static value or
compiled binding while mounting deferred children. Structural blocks and
subscriptions capture and restore that ancestry, so descendants constructed by
later branch, list, binding, or dispatch updates inherit the same nearest
provider even when no provider call is on the JavaScript stack.

The compiler assigns a source to each direct context read even when upstream
React Compiler analysis does not expose one. It lowers the read to
`createCompiledContext(scope, source, context)`. The runtime creates a local
slot from the nearest provider input; reactive provider bindings feed that slot
through the same equality-checked bridge used for component props. Downstream
DOM, component props, memo values, and effects subscribe only to the consumer
source.

Context providers are transparent owned blocks during hydration. They establish
the logical context frame while their descendants claim the server component,
element, and child-slot ranges already present in the `vidact:v1` stream; a
provider does not require or create an additional marker range of its own.

## Invariants

- The nearest matching provider wins; unrelated context frames remain visible
  through the linked parent chain.
- An explicit `undefined` provider value does not fall back to the context
  default.
- Consumers outside a provider read the `createContext` default.
- Provider-equal updates publish no consumer source write.
- Consumers created after a conditional or keyed update inherit the provider
  active at their logical owner, not the physical DOM parent.
- Removing a consumer owner removes its provider subscription before later
  provider writes.
- Hydrating a provider retains its descendant server nodes and introduces no DOM
  mutations solely for context ownership.
- Context source IDs cannot collide with React Compiler-provided prop, state,
  or derived sources and still select the wide-mask runtime when required.

## Alternatives considered

- **Transient provider stack only:** works during initial synchronous mounting
  but loses context when an updater constructs a later descendant.
- **Copy a mutable context map into every owner:** makes nesting simple but
  allocates and copies every context entry for each branch and row.
- **Reconstruct provider subtrees on value changes:** preserves lookup but loses
  state, refs, node identity, focus, and surgical mutation guarantees.

## Consequences

Context follows Vidact's logical ownership rather than DOM containment, which
is the required base for portals and error ancestry. Owners carry one optional
frame pointer, and context consumers pay for a local source slot and subscription
only when used. Conditional/loop `use(context)` lowering and custom-hook
composition remain compiler follow-ups on this runtime contract.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` verifies synthetic context
  sources and named, aliased, and namespace hook lowering.
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/context.tsx`
  records provider shorthand, `useContext`, and context-valued `use`.
- `packages/react-types/test/jsx-contract.tsx` verifies provider children use
  Vidact owned values rather than React element descriptors.
- `tests/browser/corpus/apps/context/ContextApp.browser.test.ts` proves defaults,
  nearest-provider shadowing, surgical reactive updates, cleanup, and late
  conditional inheritance.
- `tests/browser/corpus/hydration/HydrationApp.browser.test.ts` proves that a
  provider can hydrate transparently without replacing its server-rendered
  descendants.
- `examples/shop/scripts/smoke-start.mjs` verifies a hydrated framework boundary
  whose cart consumers share a reactive provider while retaining server nodes.
- `cargo test -p vidact-compiler`
- `pnpm --filter @vidact/browser-corpus test`
- `pnpm size`
