# Current support-gap audit

Updated: 2026-08-22
Audited implementation: component/prop/range/ref bridge on
`feat/rust-compiler-rebuild`

## Bottom line

The current branch is a successful vertical slice, not yet a safe React-shaped
compiler subset. It proves that compiler-assigned source masks, static updaters,
conditional ranges, and keyed record slots can update TodoMVC surgically
without rerunning the root component or diffing a Virtual DOM.

The first component-boundary gaps are now bridged: direct destructured props
use child-local updater slots, nested compiled scopes are adopted by their
owner, generic bindings own recursive value ranges, and host refs have
commit-time cleanup. Early returns, reactive spreads, and data-flow omissions
now fail closed for the covered shapes. Source and render classification uses
Oxc AST nodes and semantic bindings; exact function spans isolate multiple
components in one module; and diagnostics carry source offsets plus CLI
line/column locations. The main remaining risks are the broad DOM/React surface
and compatibility boundary: many downstream diagnostics still point at the
whole component, and many unsupported forms are not yet classified precisely.

Status terms in this audit:

- **Proven** — compiler output and real-browser behavior cover the stated case.
- **Partial** — a bounded form works, but the broader documented promise does
  not.
- **Missing** — no implementation exists.
- **Unsafe** — the construct can compile without preserving the expected
  behavior; this is more serious than an explicit rejection.

## Completed bridges

These checkmarks mean the bounded contract described in this audit is done;
they do not imply that the entire surrounding React feature family is complete.

- [x] Classify accepted named-function components from Oxc AST and semantic
      bindings instead of source-text scanning.
- [x] Analyze and lower multiple named components in one module using exact
      function spans.
- [x] Capture React Compiler's analyzed CFG as owned typed blocks/terminals and
      carry the terminal graph into Vidact's compiler IR.
- [x] Emit stable diagnostic codes with source offsets and CLI line/column
      locations.
- [x] Keep every compatibility fixture in a versioned accepted, rejected, or
      deliberately-different manifest.
- [x] Bridge direct reactive props from parent sources into child updater
      scopes.
- [x] Adopt nested component scopes into their nearest owner and dispose them
      with conditional ranges.
- [x] Normalize compiled render values across scalars, empty values, DOM nodes,
      nested arrays, bindings, and owned blocks.
- [x] Support callback and object refs on host elements, including cleanup on
      conditional removal.
- [x] Preserve keyed row identity while reordering, appending, and replacing a
      same-key immutable record.
- [x] Construct HTML, SVG, and MathML with compiler-carried host context,
      including component boundaries and SVG `foreignObject` HTML islands.
- [x] Apply deletion-aware styles, ARIA/data boolean strings, capture listeners,
      property-specific nullish removal, and React-shaped controlled form change
      timing to retained nodes.

## Promise-to-implementation matrix

The promise IDs come from
`docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md`.

| Promise                                                          | Current status                                   | Evidence and gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: direct DOM, no Virtual DOM                                   | **Partial**                                      | The Vite path lowers JSX through `@vidact/runtime/jsx-runtime`, whose `h` creates DOM nodes directly. Dynamic keyed and conditional structures are owned blocks, not runtime element trees. Generic JSX still goes through a general `h` helper rather than fully specialized DOM codegen.                                                                                                                                                                                                              |
| R2: construct once, targeted updates                             | **Proven for the supported component slice**     | `compiledRoot`, prop slots, bindings, `when`, and `keyed` preserve component and retained-row DOM. Unsupported early/nested returns are rejected. The classifier still limits which component shapes enter this slice.                                                                                                                                                                                                                                                                                  |
| R3: versioned compatibility contract                             | **Partial**                                      | `vidact-react-subset-v1` manifests accepted, rejected, and intentionally different compiler fixtures and rejects unmanifested files. The corpus is still small and is not yet a published support policy.                                                                                                                                                                                                                                                                                               |
| R4: lexical component and hook identity                          | **Proven for the accepted named-function slice** | Props, state, derived declarations, returns, JSX sites, and keyed lists come from OXC AST. Exact function spans isolate several same-module components. The owned React Compiler CFG supplies typed outer-function control flow without nested-callback or source-text false positives. Named aliases and namespace `React.useState` calls resolve through import symbols; foreign hook-shaped calls fail closed. Named arrows are recognized and source-located but remain rejected by lowering.       |
| R5: source-located diagnostics                                   | **Partial**                                      | Diagnostics carry original byte spans and the CLI reports line/column locations. Multiple render returns now reject at an exact React Compiler terminal span and compatibility rejections require spans, but many other downstream errors still fall back to the whole component, generated nodes use empty spans, and composed original-TSX source maps remain absent.                                                                                                                                 |
| R6: one model for state, props, effects, hooks, errors, disposal | **Partial**                                      | State and direct destructured prop slots, batching, static bridge subscriptions, list-item scopes, adopted child scopes, refs, and cleanup owners exist. Effects, custom hooks beyond `useRef`, context, error boundaries, and a complete prop store do not.                                                                                                                                                                                                                                            |
| R7: effect cleanup                                               | **Missing**                                      | No effect hook or effect scheduling phase exists. Internal owner cleanups do run in reverse registration order on explicit disposal.                                                                                                                                                                                                                                                                                                                                                                    |
| R8: dynamic child normalization                                  | **Proven for compiled render values**            | Generic binding ranges transition among primitives, empties, DOM nodes, recursively nested arrays, bindings, and owned blocks with value-owner disposal. Foreign React element objects and promises remain outside the contract and require stable rejection diagnostics.                                                                                                                                                                                                                               |
| R9: keyed identity and disposal                                  | **Partial**                                      | Stable keys preserve row DOM across immutable object replacement and reordering; duplicate keys fail before list mutation. Nested child scopes and refs now follow row ownership. Effects remain absent and keys are not restricted to the promised string/number domain.                                                                                                                                                                                                                               |
| R10: unkeyed arrays                                              | **Missing**                                      | There is no indexed reconciler or documented index-mode diagnostic.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| R11: multi-node ranges                                           | **Partial**                                      | Keyed records can own several nodes and empty records receive an anchor. Conditionals use comment boundaries. Components still return a single `Node` type, and there is no general component-range ABI.                                                                                                                                                                                                                                                                                                |
| R12: full DOM surface                                            | **Partial**                                      | HTML/SVG/MathML namespace construction, namespaced SVG attributes, ARIA/data booleans, deletion-aware object styles, capture listeners, listener replacement, property removal, controlled text/checkbox/multiple-select behavior, fragments, custom tags, refs, and owned opaque raw HTML work in covered cases. Reactive ref identity, prop-spread deletion, cross-browser IME/selection/form-reset behavior, unusual non-bubbling events, and full controlled/uncontrolled parity remain incomplete. |
| R13: SSR and hydration                                           | **Missing**                                      | The runtime directly references browser globals. There is no server emitter, marker protocol, hydration, or mismatch recovery.                                                                                                                                                                                                                                                                                                                                                                          |
| R14: CSP and HTML sinks                                          | **Partial**                                      | Ordinary dynamic values use DOM/text operations. The explicit `dangerouslySetInnerHTML` sink accepts strings or `TrustedHTML` without coercing trusted values, relies on browser CSP enforcement, stages parsing outside the live tree, and never creates an internal Trusted Types policy. A complete template/CSP-safe codegen mode and CSP integration suite remain missing.                                                                                                                         |
| R15: production ESM packages                                     | **Scaffold only**                                | Packages declare ESM, exports, and `sideEffects: false`, but are private and export TypeScript source. There are no built artifacts, conditions, declarations contract, package tests, or published source maps.                                                                                                                                                                                                                                                                                        |
| R16: compiler excluded and helpers shared                        | **Partial**                                      | Compiler code stays in Rust/build tooling and helpers are imported from one runtime package. Bundle budgets and helper-level subpath tree shaking are not measured.                                                                                                                                                                                                                                                                                                                                     |
| R17: shared Vite and Babel core                                  | **Partial**                                      | Vite calls the Rust core before JSX lowering. There is no Babel adapter, and each uncached TSX transform spawns `cargo run`.                                                                                                                                                                                                                                                                                                                                                                            |
| R18: support and release policy                                  | **Missing**                                      | No browser/Node support document, stable diagnostic catalog, migration guide, provenance gate, or release process exists. Browser corpus currently runs only Chromium.                                                                                                                                                                                                                                                                                                                                  |

## Highest-risk edge cases

### Bridged P0 cases

These cases motivated the current bridge and now have compiler or real-browser
regressions. Their broader syntax families still need source-located fixtures.

#### Early returns bypass the compiled root

```tsx
function Early() {
  const [ready, setReady] = useState(false)
  if (!ready) return <button onClick={() => setReady(true)}>Load</button>
  return <p>Ready</p>
}
```

Current outcome: React Compiler's owned CFG exposes each explicit return and its
original span. Vidact rejects multiple render returns with
`UnsupportedControlFlow` at the first exact return site. Tests prove that
returns inside nested callbacks, expression-level branches, and source-text
lookalikes do not cause false component rejections. DOM-range lowering for the
multi-return graph remains future work.

#### Reactive props are not a component ABI

```tsx
function Child({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  return (
    <button onClick={() => setCount(count + 1)}>
      {label}: {count}
    </button>
  )
}
```

Current outcome: direct object-destructured props become child-local slots. A
parent `CompiledBinding` feeds the slot through a statically subscribed bridge,
including `undefined` default fallback, without reinvocation. Rest, aliases,
nested patterns, addition/deletion, and spreads remain rejected or unsupported.

#### Nested compiled components are not attached to parent ownership

Current outcome: `h(Component, props)` adopts a compiled child scope into the
active component, branch, keyed-row, or value owner. Conditional removal is
covered by a test that proves later parent writes no longer reach the child.

#### Generic reactive render values are coerced to text

```tsx
const [child] = useState(<span>Hello</span>)
return <div>{child}</div>

const [values] = useState(['a', 'b'])
return <div>{values}</div>
```

Current outcome: `binding` owns a marker-delimited range and recursively
normalizes scalar, empty, DOM node, array, binding, and owned-block values.
Non-scalar replacements stage under a new owner before the prior value is
disposed. Arbitrary React element objects are not supported.

#### Reactive spreads are mount-time snapshots

```tsx
const [attrs, setAttrs] = useState({ title: 'first' })
return <div {...attrs} />
```

Current outcome: reactive JSX spreads are rejected until a deletion-aware
spread reconciler exists.

#### Source-string classification could corrupt semantic facts

Current outcome: bridged. Components, imported hooks, props, state tuples,
declarations, returns, JSX sites, and keyed maps are selected from OXC AST. OXC
symbols distinguish aliases, namespaces, foreign hooks, and shadowed bindings;
React Compiler remains responsible for derived def-use facts. Its owned
snapshot now exposes the original function span and an owned pre-reactive CFG,
so Vidact joins by exact span, carries typed terminals into `ComponentIr`,
compiles several named declarations in source order, and rejects recognized
arrow components with their original location. Strings containing `return`,
JSX, `.map(`, and `key={` do not affect classification. Remaining gaps are
arrow/default lowering, DOM-range lowering of supported control flow, narrower
non-return feature spans, and original-TSX source maps.

### P1: runtime behavior is incomplete or observably different

#### Arrays and children

| Edge case                                                                              | Current behavior                                                                                              | Required contract                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<div>{props.arrayOfJsx}</div>` where a compiled parent produces one owned keyed block | Works through a compiled child prop slot; live markers keep later updates attached after fragment staging     | Keep supported under the single-mount owned-block contract.                                                                        |
| The same owned block rendered twice                                                    | Throws `compiled block is already mounted`                                                                    | Keep the deterministic error; add source guidance or compile-time detection when possible.                                         |
| Arbitrary external `Node[]`                                                            | Static construction recursively appends it, with no reactive update or ownership                              | Treat as an explicit DOM escape hatch, not React-array compatibility.                                                              |
| Foreign `ReactElement[]`                                                               | Not a supported runtime value                                                                                 | Reject at compile/runtime boundary with a stable diagnostic.                                                                       |
| Nested keyed map depending on an outer item                                            | Explicitly rejected                                                                                           | Add nested owner/source domains before supporting it.                                                                              |
| Unkeyed `.map`                                                                         | Rejected with a keyed-map diagnostic                                                                          | Add a distinct index reconciler and keep it separate from keyed lowering.                                                          |
| Destructured map parameters or block-bodied callbacks                                  | Not recognized as keyed maps                                                                                  | Either lower from AST or reject precisely.                                                                                         |
| Fragment-rooted keyed rows                                                             | Key extraction requires an expression-bodied `JSXElement` root                                                | Support keyed fragments through an explicit key form and multi-node ranges.                                                        |
| Parent-dependent, computed, or index key expressions                                   | Rejected before IR lowering; the current normalized subset is `key={item}` or `key={item.property}`           | Extend `KeyPath` deliberately before accepting more syntax; never let codegen broaden the classifier contract.                     |
| Object, symbol, or unstable values produced by an accepted key path                    | Runtime accepts any `Map` key type                                                                            | Restrict public keys to string/number and diagnose object, symbol, random, or otherwise unstable values according to the contract. |
| Retained row updater throws                                                            | Earlier retained rows and state slots may already be updated while `records` still points to the old sequence | Define failure atomicity or route the whole batch to an error boundary with a consistent recovery policy.                          |

#### DOM, events, forms, and refs

| Edge case                                   | Current behavior                                                                                                                                                                                                                                   | Required contract                                                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SVG and MathML                              | Compiler host context selects `createElementNS`, survives component-authored calls and later structural mounts through scope-owned namespace context, and resets `foreignObject` children to HTML; SVG aliases and XLink/XML attributes are namespace-aware. Intrinsic JSX passed as component children fails closed until construction is lazy. | Add namespace-aware lazy component children, Firefox/WebKit coverage, and broader rare-attribute fixtures.                                                                     |
| `aria-hidden={false}` or `data-*={false}`   | Preserves the string `"false"`; nullish values remove the attribute                                                                                                                                                                                | Keep this rule in every intrinsic namespace and spread fallback.                                                                                                              |
| A dynamic URL/property becomes `null`       | Removes the reflected attribute; form-live properties use explicit reset logic                                                                                                                                                                     | Add URL sanitization policy and fixtures for remaining property-only targets.                                                                                                 |
| Style object removes a key                  | Removes omitted declarations, serializes numeric dimensions, and supports CSS custom properties                                                                                                                                                    | Add string-style policy, vendor-prefix fixtures, and cross-browser rollback coverage.                                                                                         |
| `onClickCapture`                            | Registers `click` with the native capture flag                                                                                                                                                                                                     | Add passive/options policy and unusual non-bubbling/custom/shadow-DOM fixtures.                                                                                               |
| Handler changes or becomes null             | Compiled prop transitions remove the exact prior listener before retaining the replacement                                                                                                                                                         | Extend failure and cross-owner replacement coverage.                                                                                                                          |
| Text input `onChange`                       | Uses native `input` timing while exposing the native event object; target classification works for direct, capture, and ancestor handlers                                                                                                          | Add composition/IME and browser-specific input-type fixtures; Vidact does not synthesize React events.                                                                        |
| Controlled input/select/textarea edge cases | Input and textarea text values, checkbox/radio checked values, handler-free rejected edits, external form-associated radio groups, prop-order-independent single/multiple selects, and post-option selection work in Chromium                      | Add controlled/uncontrolled transition policy, form reset, caret/selection, IME, Firefox, and WebKit coverage.                                                                |
| Callback/object refs                        | Attach after insertion and clear with the compiled owner; callback-returned cleanup is supported                                                                                                                                                   | Add reactive ref identity, component ref-as-prop, imperative handles, and explicit keyed-move coverage.                                                                       |
| `dangerouslySetInnerHTML`                   | Supported as an owned opaque subtree; nullish payloads are no-ops on ordinary hosts, equal payloads preserve node identity, replacements discard descendant identity, and invalid shapes/child conflicts fail before live DOM mutation             | Add cross-browser CSP-header coverage and upstream getter-object analysis support. Executable script targets remain rejected; non-executable JSON/data scripts are supported. |
| Metadata/resource tags                      | Created where written                                                                                                                                                                                                                              | Decide whether React 19 document-head hoisting and resource suspension are supported or intentionally different.                                                              |

#### Lifecycle, scheduling, and failure

- `when` stages a new branch and marks it mounted only after successful
  insertion; broader error-boundary recovery is still absent.
- `mountCompiled` cannot dispose a scope if component construction throws before
  returning its root.
- State changes are committed before updater execution. If an updater throws,
  state and DOM can be partially advanced; there is no error boundary or root
  recovery callback.
- Batching uses a synchronous runtime transaction queue. A parent scope runs
  all bridge updaters before queued child scopes drain, so one parent batch
  presents a complete prop set to each child; broader effect-phase ordering is
  still undefined.
- Host refs have an insertion commit point. Insertion, layout, and passive
  effect phases do not exist.
- There is no async-owner lifetime, cancellation, scheduler priority, or stale
  work suppression.

### P2: production and integration gaps

- Stateful arrow components are recognized by source binding and rejected with
  the original declaration name and span; lowering them remains unsupported.
- Several named function components are supported per module; arrow/default and
  nested component forms remain rejected.
- Every TSX module is sent to the compiler; non-component TSX and mixed
  component/utility modules can still fail the build.
- Static prop-only and multiple named components now enter lowering;
  non-component TSX classification remains incomplete.
- Diagnostics have stable codes and source ranges, but the catalog is
  incomplete and many downstream failures use a whole-component fallback span.
- OXC creates a source map from already-generated Rust output, so it cannot by
  itself map generated code through to the original TSX transformations.
- Vite starts `cargo run` for every uncached TSX file. There is no persistent
  compiler process, native Node binding, content-addressed disk cache, or
  production compiler artifact.
- The cache key omits compiler options, compiler/runtime protocol versions, and
  dependency/environment inputs.
- Only Chromium runs in the browser corpus. There is no Firefox/WebKit, fuzz,
  memory-retention, SSR, package-install, size, or performance gate.
- Packages are private and expose TypeScript source rather than release
  artifacts with public type and condition contracts.
- HMR state and owner disposal behavior are not tested.

## Corpus backlog

The following fixtures should exist before the corresponding syntax is called
supported. `reject` means a source-located compiler diagnostic is acceptable
until the implementation is ready.

| Area           | Progress    | Fixture                                                                                                          | Expected now                                                                                                 | Eventual behavior                                                    |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Classification | **Proven**  | aliased, namespace, shadowed, and foreign `useState` bindings                                                    | Resolve React aliases/namespaces; never transform foreign or shadowed bindings                               | Keep symbol-based classification as syntax expands.                  |
| Components     | **Partial** | arrow, default anonymous, multiple components, nested helper functions                                           | Multiple named declarations compile; arrow/default forms reject with spans                                   | Extend span-keyed lowering to supported function forms.              |
| Control flow   | **Partial** | early returns, ternaries, switch, loops, try/catch/finally                                                       | Typed CFG terminals are retained; multiple returns reject at the exact return span; add every unmodeled path | Range-aware lowering with explicit semantics.                        |
| Props          | **Partial** | add/update/delete, defaults, rest, nested destructuring, `children`, `ref`                                       | Direct prop updates/defaults work; reject unsupported patterns                                               | Complete stable prop-store semantics and component ref-as-prop.      |
| Derived values | **Partial** | aliases, mutations, closure capture, computed access, branch-dependent reads, cycles                             | Ordered aliases and cycles are covered; reject remaining ambiguity                                           | Static data-flow with deterministic updater order.                   |
| Dynamic values | **Partial** | scalar-to-empty, scalar-to-node, node-to-array, nested mixed arrays, promises, plain objects                     | Compiled values work; add explicit promise/foreign-object rejection                                          | Complete owned range normalizer and explicit DOM escape hatch.       |
| Keyed lists    | **Partial** | prepend, delete, swap, reverse, arbitrary reorder, same-key object, focus, selection, local state, refs, cleanup | Reorder, append, same-key replacement, child ownership, and refs preserve retained rows                      | Preserve the complete record owner and range across the full matrix. |
| Unkeyed lists  | **Missing** | prepend, append, truncate, reorder-looking updates                                                               | Reject with distinct index-mode guidance                                                                     | Documented index semantics.                                          |
| Nested lists   | **Missing** | parent item dependencies, empty inner lists, fragment rows, child components                                     | Reject                                                                                                       | Independent nested owner/source domains.                             |
| Events         | **Partial** | replacement, removal, capture, non-bubbling, custom case, shadow DOM, exceptions                                 | Replacement/removal/capture and React-shaped `onChange` timing work; add options and edge-event fixtures     | Correct listener lifecycle and event contract.                       |
| Forms          | **Partial** | controlled/uncontrolled transitions, IME, selection, radio, select multiple, textarea                            | Controlled text/checkbox/multiple-select and rejected-edit restoration work in Chromium                      | Cross-browser controlled-value contract.                             |
| Refs           | **Partial** | object, callback, callback cleanup, keyed move, conditional removal, imperative handle                           | Host refs and conditional cleanup work                                                                       | Add keyed-move coverage, ref-as-prop, and imperative handles.        |
| Failure        | **Missing** | initial render throw, retained-row update throw, cleanup throw, nested owner throw                               | Root error, no leak, consistent recovery                                                                     | Error boundaries and deterministic cleanup.                          |
| SSR            | **Missing** | deterministic IDs, fragments, lists, escaped data, mismatch, version skew                                        | Unsupported                                                                                                  | Shared server/client IR and hydration protocol.                      |

## What comes next

The next implementation slice should finish compiler soundness before expanding
the React surface:

1. **Lower typed render control flow and finish precise feature spans.** React
   Compiler CFG blocks and terminals now reach Vidact's Rust IR. Convert the
   supported return/branch graph into owned DOM ranges instead of relying on a
   single top-level return. Point spread, key, and expression rejections at
   their exact sites and start original-TSX source-map segments at the same IR
   boundary.
2. **Complete the component ABI.** Make a component own a general multi-node
   range, then extend prop slots into stable add/update/delete semantics for
   `children`, rest, spreads, and supported destructuring forms. Lower named
   arrow and export forms only after they use this same ABI.
3. **Finish the declared DOM subset.** The central namespace, attribute, style,
   capture, and controlled-form policies are implemented. Close the remaining
   prop-spread, reactive-ref, IME/selection/form-reset, unusual-event, and
   Firefox/WebKit gaps without broadening the type contract ahead of evidence.
4. **Define lifecycle and failure semantics.** Add insertion/layout/passive
   effect phases with cleanup, then construction/update error recovery and error
   boundaries before adding Suspense or async owners.
5. **Expand array semantics deliberately.** Add a separate unkeyed index
   reconciler, nested source/owner domains, fragment-rooted rows, a public key
   domain, and retained-row failure atomicity.
6. **Productionize the toolchain.** Add a persistent compiler or native binding,
   complete cache keys, publishable artifacts and source maps, Firefox/WebKit,
   bundle/performance gates, then SSR and hydration on a shared IR.

## Release-gate progress

Before adding broad React compatibility claims:

- [x] Establish a versioned accepted/rejected/different compatibility manifest
      that fails when a fixture is unclassified.
- [x] Replace source-text component discovery with Oxc AST/symbol analysis and
      exact per-function spans.
- [x] Support several named function components in one module without joining
      React Compiler facts to the wrong function.
- [x] Carry diagnostic codes and original source locations through the CLI.
- [x] Carry React Compiler's typed terminal graph into Vidact IR and reject
      multiple returns at an exact return site without callback/string false
      positives.
- [x] Prove the direct-prop, adopted-owner, mixed-value, ref, conditional, and
      keyed same-record bridges with compiler and/or browser tests.
- [ ] Expand the manifest until every known P0 form rejects at its precise
      feature span rather than a whole-component fallback.
- [ ] Lower the typed multi-return graph into DOM ranges and add original-TSX
      source maps.
- [ ] Extend the implemented direct-prop/adopted-owner ABI into a complete prop
      store and multi-root component range.
- [ ] Add explicit foreign-object and promise diagnostics to mixed-value ranges.
- [ ] Establish component construction, nested disposal, updater failure, and
      error-recovery invariants.
- [x] Complete the central namespace, property-reset, object-style, ARIA/data,
      capture, and controlled-form behavior for the declared DOM subset.
- [ ] Complete prop-spread deletion, reactive refs, unusual event options,
      controlled/uncontrolled transitions, IME/selection/form reset, and
      Firefox/WebKit coverage.
- [ ] Add Firefox/WebKit, package-install, bundle-size, compiler-performance,
      and memory-retention gates.

## Evidence consulted

- `README.md`
- `docs/architecture/react-analysis-boundary.md`
- `docs/architecture/keyed-record-updaters-and-owned-blocks.md`
- `docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md`
- `crates/vidact-compiler/src/oxc_react.rs`
- `crates/vidact-compiler/tests/react_compiler_control_flow.rs`
- `crates/vidact-compiler/src/surgical_codegen/mod.rs`
- `packages/runtime/src/compiled.ts`
- `packages/runtime/src/direct-dom.ts`
- `packages/runtime/src/keyed-list.ts`
- `packages/vite-plugin/src/compiler-client.ts`
- `packages/vite-plugin/src/index.ts`
- Rust, runtime browser, and TodoMVC tests

The compiler observations for early returns, reactive props, reactive spreads,
state-held JSX, and state-held arrays were reproduced against the local
`vidactc` binary at the audited revision.
