# shadcn Base UI as a compatibility corpus

- Decision state: Accepted
- Decided: 2026-08-27
- Amends: [Lowered React dependency capsules](lowered-react-dependency-capsules.md)
- Amends: [Deletion-aware reactive spreads and rest props](deletion-aware-reactive-spreads-and-rest-props.md)

## Context

Fumadocs UI currently builds its component layer on Base UI and adopts shadcn's
theme model. Importing Fumadocs UI as an opaque React package would test whether
Vidact can silently host a second renderer, not whether its construct-once owner
model can support a documentation system. The current shadcn Base UI registry is
a better stress corpus because its generated source exposes the primitive calls,
wrapper props, local hooks, icon imports, and third-party renderer dependencies
that a native implementation must confront.

The registry also distinguishes compilation from compatibility. A module can
lower in a production graph and still fail when mounted, fail Vidact's JSX type
surface, or rely on child/key identity that cannot be preserved by an ordinary
spread. A package-level success claim would hide those differences.

## Decision

Vidact treats the current official shadcn Base UI component registry as a
versioned compatibility corpus, not as a package allowlist or a promise that all
React packages work. `examples/docs/src/shadcn-compatibility.ts` records the
first known boundary for every component entry, and
`examples/docs/src/shadcn-corpus.ts` makes the compile-certified subset reachable
from a dedicated, unloaded production-build entry. The browser client does not
initialize corpus modules that the current page does not render.

The compiler accepts only normalization work that preserves existing owners:

- literal properties, stable identifier properties, and genuinely reactive
  expressions before one final reactive spread
  are coalesced into one ordered object expression when none of the preceding
  properties requires separate key, ref, child, raw-HTML, or renderable
  ownership;
- `useState()` lowers to a state slot initialized with `undefined`;
- server codegen preserves a `useState` or `useReducer` tuple whenever its
  dispatcher position is bound, preventing SSR state-value inlining from
  leaving an escaping context or prop dispatcher as an unbound identifier;
- expression-bodied module-local custom hooks normalize before hygienic
  expansion;
- directly imported hooks from qualified React-bearing dependencies are
  source-linked into the consuming module before hygienic expansion, without
  creating a runtime or re-export hook ABI;
- frozen, write-free `Object.freeze([])` dependency constants normalize to the
  same static empty dependency list as `[]`;
- complex custom-hook arguments inside a conditional stay inside that guard,
  while flat object destructuring in expanded hook bodies becomes explicit
  derived declarations;
- provider-owned precomputed children are constructed under their provider
  context after React analysis, so the normalization cannot perturb Oxc's SSA
  discovery; the runtime helper rejects an unbranded context rather than
  silently treating an arbitrary `.Provider` component as context;
- dependency roots with a statically paired provider can derive flat parameter
  destructuring, including spec-correct object rest, from their compiled prop
  slot;
- dependency `forwardRef` analysis binds to the exported component declaration
  rather than an unrelated inner function name;
- expression-bodied inline dependency `forwardRef` arrows normalize to an
  ordinary block-bodied component;
- automatic-runtime fragments with one `key` lower to a key-bearing Vidact
  fragment component whose runtime result is the already-owned child range;
- dependency-source analysis leaves manual-memo identity to Vidact's authored
  `useMemo` lowering instead of React Compiler's preservation validator;
- simple identifier `||=` statements normalize to an equivalent structured
  `if` before upstream analysis;
- React 19 guards may select an immutable local hook-function alias before
  hygienic expansion; and
- verified transpiler-only `Function.name` statements are erased even when
  they annotate an otherwise removable hook binding;
- classic factory props may coalesce before a final `children` property, which
  becomes the element's explicit children.

Generated wrappers that forward `children` through a rest spread remain outside
the spread contract. The local Button, Alert, Card, and Kbd sources destructure
`children` and author it explicitly. The behaviorless Separator wrapper lowers
to an equivalent native separator element. Three compile-certified components
replace Phosphor React icons with inline SVG or text because the published icon
barrel eagerly reaches the whole renderer-bearing icon catalog and individual
minified icon modules reach a context read inside an aliased component that is
not yet a direct compiled declaration.

The docs example uses Fumadocs as a headless server-side content source and
Vidact Start for routing, SSR, hydration, and client navigation. The shell is
built from local shadcn sources; it does not import `fumadocs-ui` and does not
emulate a React runtime. Its production verifier rejects React package imports,
React element tags, `react-dom` rendering, and compatibility adapters.

## Compatibility boundary

The checked-in matrix currently distinguishes production compilation from
browser proof:

- Button, Input, published Base UI Collapsible, and the local Popover have
  browser interaction plus stable-owner proof;
- Kbd mounts statically in the docs shell and Separator mounts through the
  bounded Markdown renderer; Alert and Card remain production-build-only
  pending mount-safe child/rest forwarding proof;
- Avatar mounts under its provider context but still needs a reactive
  image-status identity proof;
- 26 more modules compile into the React-free production corpus but remain
  build-only;
- 8 modules depend on renderer-coupled React packages such as Recharts, cmdk,
  React DayPicker, Embla, or React Resizable Panels;
- 1 module re-exports an unversioned package hook; and
- 17 modules reach a diagnosed Base UI or React Compiler boundary such as a
  hook-bearing class method, render-time mutation of a hook-returned value, or
  Base UI's hook-replay `fastComponentRef` wrapper.

Six former `useRender` blockers—Attachment, Badge, Bubble, Button Group, Item,
and Marker—production-compile because the consuming module and its
qualified dependency imports form one source-linked capsule. Breadcrumb and
Accordion avoid Phosphor's renderer-coupled context through corpus-local inline
SVGs. Checkbox compiles after simple `||=` normalization, while Progress and
Scroll Area compile under Vidact-owned memo semantics. Sidebar moves past its
render-time prop mutation and remains blocked by Sheet and Tooltip. The
Direction utility remains unsupported because it re-exports `useDirection`;
source linking intentionally does not pretend that a later module can call an
exported hook without a versioned owner-aware ABI.

Compile certification is not mount certification. The browser proof mounts the
docs shell and exercises shadcn's Base UI Button and Input. A second proof mounts
Avatar and opens an uncontrolled Collapsible. The Collapsible proof requires
the published `useRenderElement` path to retain its root and trigger, update
`aria-expanded`, and publish the panel within a bounded mutation envelope.

Popover is a local shadcn implementation rather than evidence that Base UI's
Store class compiles. Its framework-neutral observer has stable methods, and
the Popover root is the only consumer that calls `useSyncExternalStore`.
Compiled context carries the resulting snapshot and imperative actions to the
Trigger and Content. The root subscription and trigger live for the root mount;
each open interval owns one portal range plus its focus, dismissal, and geometry
effects. Controlled interactions request a change without publishing visibility
until the parent commits a new `open` value. This boundary avoids a generic
class-instance hook inference rule and does not certify modal focus management,
collection navigation, or toast lifecycles.

The generated registry uses React's JSX declarations as its authoring ABI.
Base UI and the copied shadcn sources publish React-shaped component signatures,
so `@vidact/react-types` cannot validate the registry without widening Vidact's
owned render values into React element descriptors. This is type-level
compatibility only: the Vite plugin still compiles the source into Vidact owners,
and the production verifier rejects retained React modules. Vidact-native apps
that do not consume React-typed source should continue to use
`@vidact/react-types`.

The cmdk audit is now past five reusable lowered-dependency blockers:
single-child `cloneElement`, standard transpiler name wrappers around inline
`forwardRef` functions, single-child dynamic intrinsic `createElement`, and
Radix's composed-ref rest/callback-factory shape, plus verified standalone
transpiler name metadata. The next cmdk-owned failure is Radix Slot's component
factory: it creates a `forwardRef` component inside `createSlot`, and that nested
component calls `useComposedRefs`. Command also reaches the independently
diagnosed Base UI Store/portal graph. Its local icon barrel has been replaced
with direct SVG ownership, but this progress is not a support claim for Command.

## Invariants

- Registry support is selected by syntax and dependency provenance, never by a
  shadcn, Base UI, or Fumadocs package name.
- Every compile-certified module is reachable in the production corpus and a
  compiler failure fails the build.
- Production output contains no React renderer, element descriptor, or fallback
  adapter.
- Ordered spread normalization preserves JavaScript object-spread precedence.
- `key`, `ref`, spread-owned `children`, raw HTML, and element-valued leading
  props are not smuggled through ordinary spread ownership.
- Browser certification requires both an interaction assertion and retained DOM
  owner identity with a bounded mutation envelope.
- A local Store-backed component may use one direct root subscription only when
  its subscribe and snapshot functions are stable, nonreactive values created in
  that root. Context consumers derive from the root snapshot and never hide hook
  calls behind arbitrary instance methods.
- Compiled scheduler order follows source write-to-read dependencies even when a
  runtime memo registered before a compiler-generated prerequisite. This keeps
  one construct-once propagation pass without replaying component bodies.
- A compiled state setter may retire state only while its owner participates in
  the active disposal cascade. A setter retained from an earlier, unrelated
  disposal remains an error.
- A server-bound state or reducer dispatcher retains the server runtime's stable
  dispatch function. Passing it through context or props is valid; invoking it
  during server rendering throws instead of mutating or replaying a component.
- Fumadocs may contribute server-only content data, but no Fumadocs renderer,
  component tree, or client runtime may cross the Start snapshot.

## Alternatives considered

- **Run Fumadocs UI through React compatibility:** rejected because it adds a
  second owner graph and makes React replay, reconciliation, and hook ordering
  observable inside a Vidact root.
- **Call every successfully parsed module supported:** rejected because parsing,
  production lowering, mounting, interaction behavior, DOM identity, and type
  compatibility are separate claims.
- **Allow arbitrary `children` and `key` in reactive spreads:** rejected because
  those values select owned ranges and identity; treating them as ordinary
  enumerable props can leak or remount subtrees.
- **Pass through opaque icon or widget packages:** rejected because emitted code
  would retain React component factories even if the immediate entry looked
  data-only.

## Consequences

The corpus produced several reusable compiler improvements and a React-free docs
starter, while keeping unsupported semantics explicit. The local component
source has small ownership-oriented adaptations, so updating from a future
shadcn registry requires reapplying or eliminating those adaptations.

The highest-value next work is a versioned cross-module hook/data ABI for
re-exports, Vidact JSX typing for compatible external component signatures,
source-proven child-spread
extraction, and focused mount tests for the remaining production-compiled
entries. Renderer-coupled widget packages, hook-bearing class methods,
hook-replay component wrappers, and render-time hook-object mutation remain
incompatible by design.

## Verification

- `crates/vidact-compiler/tests/surgical_codegen.rs` covers ordered reactive JSX
  spreads, zero-argument state, expression-bodied local hooks, guarded hook
  arguments, deep optional-chain and left-logical hook bases, React 19 hook aliases,
  dependency-owned memo semantics, simple logical assignments, provider-owned
  construction, and reactive object destructuring.
- `crates/vidact-compiler/tests/lowered_react.rs` covers exported `forwardRef`
  binding identity, expression-bodied inline arrows, verified transpiler name
  wrappers and statements, keyed factory fragments, final factory `children`
  coalescing, and guarded dynamic intrinsic children.
- `crates/vidact-compiler/tests/server_codegen.rs` covers dispatcher preservation
  inside a dependency-owned `forwardRef` component.
- `packages/vite-plugin/test/base-ui.integration.test.ts` server-renders the
  published Base UI Avatar provider and fallback from a React-free bundle.
- `examples/docs/test/vite-dev.test.ts` requests the generated Avatar reference
  page through the real Vite SSR development pipeline.
- `examples/docs/src/App.browser.test.ts` exercises the Base UI-backed Button and
  Input and asserts surgical sidebar/theme updates with retained page owners.
- `examples/docs/src/ComponentShowcase.browser.test.ts` mounts the integrated
  component showcase and operates the four interaction-certified controls.
- `examples/docs/src/ShadcnExpansionProof.browser.test.ts` proves Avatar context
  construction plus functional, accessible Collapsible interaction with
  retained root and trigger owners.
- `examples/docs/src/PopoverProof.browser.test.ts` proves uncontrolled and
  controlled Popover behavior, retained trigger identity, bounded portal
  mutations, reason-aware focus, dismissal, and disposal cleanup.
- `tests/browser/corpus/apps/composed-refs/ComposedRefsApp.browser.test.ts`
  proves composed callback refs replace in detach-before-attach order without
  replacing or mutating their host node.
- `examples/docs/scripts/audit-shadcn-compatibility.mjs` builds all 61 generated
  modules independently and classifies production compilation separately from
  browser certification.
- `examples/docs/scripts/verify-production-bundle.mjs` rejects React runtime and
  compatibility paths in emitted JavaScript.

Run `cargo test -p vidact-compiler`,
`pnpm --filter @vidact/example-docs test`, and
`pnpm --filter @vidact/example-docs build`.
