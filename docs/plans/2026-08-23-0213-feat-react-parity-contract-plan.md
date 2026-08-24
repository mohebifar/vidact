---
title: React Parity Contract - Plan
type: feat
date: 2026-08-23
topic: react-parity-contract
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
---

# React Parity Contract - Plan

## Goal Capsule

- **Objective:** Define the React compatibility Vidact must deliver, the
  intentional differences it will preserve, and the uncommon capabilities that
  require explicit compiler opt-in.
- **Product authority:** This contract refines the React-shaped subset promised
  by `docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md` and uses
  `docs/roadmap/react-parity-gap-audit.md` as the current surface inventory.
- **Open blockers:** None. Planning may choose implementation sequencing but
  may not move default requirements behind feature flags to make delivery
  easier.

---

## Product Contract

### Summary

Vidact will support modern React 19.2 web application authoring through a small
default client contract, separate production server/hydration targets, and
explicit opt-in families for uncommon cross-cutting behavior. It will not ship
a React element interpreter, Virtual DOM, Fiber renderer, or blanket React
fallback.

### Problem Frame

The current compiler proves direct DOM construction, fine-grained state
updates, owned component ranges, keyed and indexed lists, structured control
flow, refs, DOM namespaces, controlled forms, raw HTML ownership, and
transactional publication. The implementation still accepts only a bounded
component/prop/hook subset and lacks the lifecycle, context, error, server, and
ecosystem contracts used by ordinary React applications.

API-count parity would solve the wrong problem. Some React APIs require global
schedulers, resource caches, server protocols, or development instrumentation
that many applications never use. Conversely, the current counter bundle pays
for forms, raw HTML, styles, events, and namespace machinery even when its
source does not use those features. The product needs both a compatibility
boundary and a pay-for-what-you-use runtime boundary.

### Key Decisions

- **Target React-shaped web authoring rather than renderer equivalence.** The
  existing direct-DOM, construct-once identity remains authoritative. Governs
  R1, R2, R8, R9.
- **Make common application and library-interoperability behavior default.** A
  normal React function-component app should not require feature discovery
  before it compiles. Governs R3, R10-R13, R15.
- **Gate uncommon global machinery, not ordinary local syntax.** Static
  capability reachability handles usage-local cost; compiler flags handle
  semantic families with cross-cutting carrying cost. Governs R5-R7.
- **Treat SSR and hydration as required targets.** They remain outside a
  client-only bundle but are not deferred as optional product identity.
  Governs R4, R14.

### Requirements

**Compatibility authority**

- R1. The compatibility contract MUST inventory every stable modern React 19.2
  web hook, component, API, DOM behavior family, client/server/static entry
  point, and relevant directive.
- R2. Every inventoried surface MUST be classified as default core, required
  build target, opt-in feature, adapted behavior, diagnosed incompatibility, or
  tracked upstream behavior.
- R3. Default core MUST cover ordinary function-component syntax, props and
  children, state, reducers, refs, effects, context, memoized identity, errors,
  portals, external stores, IDs, lists, browser events/forms, and custom hooks.
- R4. Deterministic SSR and whole-root hydration MUST be production requirements
  exposed through server and hydration targets that add no code to a
  client-only build.

**Feature and bundle policy**

- R5. Unsafe raw HTML, async resources/Suspense, concurrent scheduling,
  Actions, insertion effects, retained hidden UI, profiling, and framework
  protocols MUST be disabled by default and independently opt-in.
- R6. Usage-local runtime capabilities MUST be reachable per final chunk so an
  application does not ship unused list, form, raw-HTML, style, namespace, ref,
  portal, or other helper families.
- R7. Build targets and feature choices MUST participate in diagnostics,
  compiler/runtime protocols, source maps, cache keys, package conditions, and
  incremental gzip budgets; enabling an unused feature MUST add no browser
  bytes.

**Differences and diagnostics**

- R8. Vidact MUST document and type its construct-once components, native DOM
  events, function error boundaries, compiler-adapted memoization, synchronous
  default scheduler, and any physical-DOM portal event propagation as
  intentional differences.
- R9. React element inspection, arbitrary element descriptors, class
  components, Fiber semantics, renderer integrations, and opaque precompiled
  React packages MUST fail with source-located migration guidance rather than
  introduce a fallback renderer.
- R10. No unsupported syntax or API MAY compile into behavior that silently
  drops updates, attaches ineffective events, leaks ownership, or corrupts DOM;
  every known unsupported form MUST reject at its original feature span.

**Default application behavior**

- R11. The compiler MUST support common component/export forms, complete prop
  add/update/delete semantics, deferred owned children, spreads, component-
  valued props, nested lists, and sound static reactivity across accepted
  control flow.
- R12. The runtime MUST provide one ownership-aware lifecycle for hooks,
  effects, commit phases, refs, context, errors, portals, external stores,
  batching, and disposal without rerunning components for diffing.
- R13. The supported DOM contract MUST cover React-shaped HTML, SVG, MathML,
  custom elements, properties, styles, events, controlled/uncontrolled forms,
  refs, namespaces, and security behavior across Chromium, Firefox, and WebKit.
- R14. Server and hydration targets MUST share the semantic compiler contract,
  produce injection-safe deterministic output, claim existing nodes without a
  Virtual DOM, and recover from mismatches at documented boundaries.

**Ecosystem and production readiness**

- R15. Compatible dependency source MUST be compilable through explicit
  package conditions and include controls, while renderer-dependent libraries
  fail before browser execution.
- R16. Vidact MUST ship built ESM/types/source maps, a production compiler
  artifact or persistent service, complete cache invalidation, HMR ownership,
  browser/Node support policy, diagnostics catalog, security gates, provenance,
  and semantic versioning guidance.
- R17. Compatibility claims MUST be backed by accepted/rejected/different
  compiler fixtures, real-browser behavior, representative ecosystem apps,
  memory/performance evidence, and total production bundle measurements.

### Acceptance Examples

- AE1. **Covers R3, R11-R13.** Given an ordinary client application using
  function components, props/children, state/reducer/ref, context, effects,
  errors, a router/store, lists, forms, and a portal, when it is compiled with
  default settings, then it runs without React in the production bundle and
  without feature opt-ins.
- AE2. **Covers R5, R7, R10.** Given source containing `<Suspense>` while
  `async` is disabled, when it is compiled, then compilation fails at
  `<Suspense>` and names the `async` feature; enabling `async` makes the source
  eligible without enabling unrelated features.
- AE3. **Covers R5-R7.** Given a counter that uses no raw HTML, form control,
  SVG/MathML, list, portal, or profiling API, when its production chunk is
  measured, then none of those capability modules contribute rendered bytes.
- AE4. **Covers R4, R14.** Given matching output from the server target, when
  the hydration target starts, then it retains existing DOM identity, restores
  owner/list/ref state, and reports a localized mismatch without installing a
  Virtual DOM.
- AE5. **Covers R8-R10.** Given a library that expects React element inspection
  or class lifecycle behavior, when Vidact analyzes its source or import
  boundary, then it emits migration guidance rather than allowing a runtime
  failure or embedding React.
- AE6. **Covers R15-R17.** Given a supported router, external store, and
  source-published component library, when the representative application is
  installed and built from published artifacts, then types, source maps,
  effects/context/portals, HMR disposal, browser behavior, and bundle budgets
  pass the release gates.

### Success Criteria

- The canonical parity audit has no unclassified stable React 19.2 web surface.
- Every default and opt-in surface has positive behavior coverage or a precise
  rejection fixture until implemented.
- Default-core representative applications require no compatibility flags and
  ship no React runtime.
- Each opt-in family has an isolated incremental gzip measurement, and unused
  enabled families tree-shake away.
- Client, server, and hydration packages pass cross-browser, protocol-skew,
  source-map, security, clean-install, and representative-application gates.

### Scope Boundaries

**Opt-in after default core**

- Async resources and Suspense, concurrent scheduling, Actions, insertion
  effects, retained hidden UI, profiling, and framework/server protocols.
- Streaming, prerender/resume, Server Components, Server Functions, resource
  hoisting, and metadata coordination under the `framework` family.

**Outside Vidact's identity**

- A public runtime React element tree, Virtual DOM, Fiber renderer, or embedded
  React fallback.
- General class-component and legacy element-inspection compatibility.
- React Native, custom renderer APIs, or React DevTools protocol equivalence.
- Stability promises for Canary or experimental React APIs before their
  upstream contracts settle.

### Dependencies and Assumptions

- React 19.2 remains the reference baseline until a deliberate compatibility
  contract version bump.
- The patched Oxc React Compiler remains an analysis dependency, while Vidact's
  stable IR and direct-DOM ownership model remain authoritative.
- Feature frequency is a product judgment until usage telemetry or corpus data
  exists; opt-in boundaries should be revisited with evidence without moving
  default requirements solely to meet a size target.

### Sources and Research

- `docs/roadmap/react-parity-gap-audit.md`
- `docs/roadmap/current-support-gap-audit.md`
- `docs/roadmap/react-feature-roadmap.md`
- `docs/architecture/compact-compiler-runtime-abi.md`
- `docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md`
- React 19.2 API reference: <https://react.dev/reference/react>
- React 19.2 hooks: <https://react.dev/reference/react/hooks>
- React DOM reference: <https://react.dev/reference/react-dom>
