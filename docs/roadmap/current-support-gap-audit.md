# Current support-gap audit

Updated: 2026-08-21
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
now fail closed for the covered shapes. Source and render classification now
uses OXC AST nodes and semantic bindings. The main remaining risks are the
broad DOM/React surface and compatibility boundary: diagnostics still lack
spans and many unsupported forms are not yet classified precisely.

Status terms in this audit:

- **Proven** — compiler output and real-browser behavior cover the stated case.
- **Partial** — a bounded form works, but the broader documented promise does
  not.
- **Missing** — no implementation exists.
- **Unsafe** — the construct can compile without preserving the expected
  behavior; this is more serious than an explicit rejection.

## Promise-to-implementation matrix

The promise IDs come from
`docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md`.

| Promise | Current status | Evidence and gap |
|---|---|---|
| R1: direct DOM, no Virtual DOM | **Partial** | The Vite path lowers JSX through `@vidact/runtime/jsx-runtime`, whose `h` creates DOM nodes directly. Dynamic keyed and conditional structures are owned blocks, not runtime element trees. Generic JSX still goes through a general `h` helper rather than fully specialized DOM codegen. |
| R2: construct once, targeted updates | **Proven for the supported component slice** | `compiledRoot`, prop slots, bindings, `when`, and `keyed` preserve component and retained-row DOM. Unsupported early/nested returns are rejected. The classifier still limits which component shapes enter this slice. |
| R3: versioned compatibility contract | **Missing** | README language is intentionally cautious, but there is no accepted/rejected/different fixture manifest or versioned public subset. |
| R4: lexical component and hook identity | **Proven for the accepted named-function slice** | Props, state, derived declarations, returns, JSX sites, and keyed lists come from OXC AST. Named aliases and namespace `React.useState` calls resolve through import symbols; foreign hook-shaped calls fail closed. Multiple components and non-declaration component forms remain explicitly unsupported until analysis is keyed by function span. |
| R5: source-located diagnostics | **Unsafe** | `Diagnostic` contains only a code and message. Generated nodes use empty spans, and the CLI reports a filename without a source range. Some unsupported forms are accepted and become stale instead of producing a diagnostic. |
| R6: one model for state, props, effects, hooks, errors, disposal | **Partial** | State and direct destructured prop slots, batching, static bridge subscriptions, list-item scopes, adopted child scopes, refs, and cleanup owners exist. Effects, custom hooks beyond `useRef`, context, error boundaries, and a complete prop store do not. |
| R7: effect cleanup | **Missing** | No effect hook or effect scheduling phase exists. Internal owner cleanups do run in reverse registration order on explicit disposal. |
| R8: dynamic child normalization | **Proven for compiled render values** | Generic binding ranges transition among primitives, empties, DOM nodes, recursively nested arrays, bindings, and owned blocks with value-owner disposal. Foreign React element objects and promises remain outside the contract and require stable rejection diagnostics. |
| R9: keyed identity and disposal | **Partial** | Stable keys preserve row DOM across immutable object replacement and reordering; duplicate keys fail before list mutation. Nested child scopes and refs now follow row ownership. Effects remain absent and keys are not restricted to the promised string/number domain. |
| R10: unkeyed arrays | **Missing** | There is no indexed reconciler or documented index-mode diagnostic. |
| R11: multi-node ranges | **Partial** | Keyed records can own several nodes and empty records receive an anchor. Conditionals use comment boundaries. Components still return a single `Node` type, and there is no general component-range ABI. |
| R12: full DOM surface | **Partial and unsafe** | Basic HTML properties, attributes, styles, events, forms, fragments, custom tags, and object/callback refs work in covered cases. SVG/MathML namespaces, correct ARIA false values, style removal, capture events, handler replacement, reactive ref identity, prop-spread updates, complete controlled forms, and explicit unsafe HTML are absent or incorrect. |
| R13: SSR and hydration | **Missing** | The runtime directly references browser globals. There is no server emitter, marker protocol, hydration, or mismatch recovery. |
| R14: CSP and HTML sinks | **Partial** | The direct path avoids runtime code generation and rejects `dangerouslySetInnerHTML`. There is no documented explicit unsafe-HTML API, Trusted Types contract, or paired template/CSP-safe mode. |
| R15: production ESM packages | **Scaffold only** | Packages declare ESM, exports, and `sideEffects: false`, but are private and export TypeScript source. There are no built artifacts, conditions, declarations contract, package tests, or published source maps. |
| R16: compiler excluded and helpers shared | **Partial** | Compiler code stays in Rust/build tooling and helpers are imported from one runtime package. Bundle budgets and helper-level subpath tree shaking are not measured. |
| R17: shared Vite and Babel core | **Partial** | Vite calls the Rust core before JSX lowering. There is no Babel adapter, and each uncached TSX transform spawns `cargo run`. |
| R18: support and release policy | **Missing** | No browser/Node support document, stable diagnostic catalog, migration guide, provenance gate, or release process exists. Browser corpus currently runs only Chromium. |

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

Current outcome: surgical lowering rejects any component without exactly one
top-level return. Modeled multi-return control flow and source spans remain
future work.

#### Reactive props are not a component ABI

```tsx
function Child({ label }: { label: string }) {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{label}: {count}</button>
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
declarations, returns, JSX sites, and keyed maps are selected from OXC AST.
OXC symbols distinguish aliases, namespaces, foreign hooks, and shadowed
bindings. React Compiler remains responsible for derived def-use facts. Tests
also prove that strings containing `return`, JSX, `.map(`, and `key={` do not
affect classification.

Remaining gap: React Compiler's owned snapshot exposes a component name but no
stable function span. Vidact therefore accepts exactly one named function
component per module and rejects multiple components rather than risking mixed
facts. Diagnostics still need original source ranges.

### P1: runtime behavior is incomplete or observably different

#### Arrays and children

| Edge case | Current behavior | Required contract |
|---|---|---|
| `<div>{props.arrayOfJsx}</div>` where a compiled parent produces one owned keyed block | Works through a compiled child prop slot; live markers keep later updates attached after fragment staging | Keep supported under the single-mount owned-block contract. |
| The same owned block rendered twice | Throws `compiled block is already mounted` | Keep the deterministic error; add source guidance or compile-time detection when possible. |
| Arbitrary external `Node[]` | Static construction recursively appends it, with no reactive update or ownership | Treat as an explicit DOM escape hatch, not React-array compatibility. |
| Foreign `ReactElement[]` | Not a supported runtime value | Reject at compile/runtime boundary with a stable diagnostic. |
| Nested keyed map depending on an outer item | Explicitly rejected | Add nested owner/source domains before supporting it. |
| Unkeyed `.map` | Rejected with a keyed-map diagnostic | Add a distinct index reconciler and keep it separate from keyed lowering. |
| Destructured map parameters or block-bodied callbacks | Not recognized as keyed maps | Either lower from AST or reject precisely. |
| Fragment-rooted keyed rows | Key extraction requires an expression-bodied `JSXElement` root | Support keyed fragments through an explicit key form and multi-node ranges. |
| Parent-dependent, computed, or index key expressions | Rejected before IR lowering; the current normalized subset is `key={item}` or `key={item.property}` | Extend `KeyPath` deliberately before accepting more syntax; never let codegen broaden the classifier contract. |
| Object, symbol, or unstable values produced by an accepted key path | Runtime accepts any `Map` key type | Restrict public keys to string/number and diagnose object, symbol, random, or otherwise unstable values according to the contract. |
| Retained row updater throws | Earlier retained rows and state slots may already be updated while `records` still points to the old sequence | Define failure atomicity or route the whole batch to an error boundary with a consistent recovery policy. |

#### DOM, events, forms, and refs

| Edge case | Current behavior | Required contract |
|---|---|---|
| SVG and MathML | Uses `document.createElement` for every tag | Emit namespace-aware element and attribute operations. |
| `aria-hidden={false}` or `data-*={false}` | Removes the attribute | Preserve string-valued ARIA/data semantics. |
| A dynamic URL/property becomes `null` | Generic property clearing often assigns `false` | Use property-specific reset/removal rules. |
| Style object removes a key | `Object.assign` leaves the old style in place | Diff prior keys and handle object/string/null transitions and CSS custom properties. |
| `onClickCapture` | Becomes a listener for the nonexistent `clickcapture` event | Parse capture, bubbling, non-bubbling, passive, and custom event cases. |
| Handler changes or becomes null | Generic prop updates can add listeners without removing the old listener | Store and replace listener identity; dispose direct listeners. |
| Text input `onChange` | Maps to the native `change` event | Specify React-shaped input/change behavior or document the intentional DOM-native difference. |
| Controlled input/select/textarea edge cases | Direct property writes cover common cases only | Test value/checked/default values, radio groups, multiple select, composition, caret and selection retention. |
| Callback/object refs | Attach after insertion and clear with the compiled owner; callback-returned cleanup is supported | Add reactive ref identity, component ref-as-prop, imperative handles, and explicit keyed-move coverage. |
| `dangerouslySetInnerHTML` | Throws | Replace with a deliberately named, CSP/Trusted-Types-aware unsafe API; keep React's sink diagnosed if it is outside the subset. |
| Metadata/resource tags | Created where written | Decide whether React 19 document-head hoisting and resource suspension are supported or intentionally different. |

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

- Stateful arrow components are analyzed but surgical codegen only locates
  named function declarations; the current diagnostic can mention
  `AnonymousComponent` rather than the source declaration.
- Exactly one React Compiler-analyzed component is allowed per module.
- Every TSX module is sent to the compiler; non-component TSX and multi-component
  utility modules can fail the build.
- Static prop-only components now enter lowering; non-component TSX and
  multi-component module classification remain incomplete.
- Generated diagnostics have no source ranges or stable feature-specific codes.
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

| Area | Fixture | Expected now | Eventual behavior |
|---|---|---|---|
| Classification | aliased, namespace, shadowed, and foreign `useState` bindings | Reject unsupported aliases; never transform foreign/shadowed bindings | Resolve imports and symbols lexically. |
| Components | arrow, default anonymous, multiple components, nested helper functions | Reject precisely | Compile each component by semantic span. |
| Control flow | early returns, ternaries, switch, loops, try/catch/finally | Reject every unmodeled path | Range-aware lowering with explicit semantics. |
| Props | add/update/delete, defaults, rest, nested destructuring, `children`, `ref` | Direct prop updates/defaults work; reject unsupported patterns | Complete stable prop-store semantics and component ref-as-prop. |
| Derived values | aliases, mutations, closure capture, computed access, branch-dependent reads, cycles | Reject ambiguity | Static data-flow with deterministic updater order. |
| Dynamic values | scalar-to-empty, scalar-to-node, node-to-array, nested mixed arrays, promises, plain objects | Compiled values work; reject promises/foreign objects | Complete owned range normalizer and explicit DOM escape hatch. |
| Keyed lists | prepend, delete, swap, reverse, arbitrary reorder, same-key object, focus, selection, local state, refs, cleanup | Only DOM/item bindings are supported | Preserve the complete record owner and range. |
| Unkeyed lists | prepend, append, truncate, reorder-looking updates | Reject with guidance | Documented index semantics. |
| Nested lists | parent item dependencies, empty inner lists, fragment rows, child components | Reject | Independent nested owner/source domains. |
| Events | replacement, removal, capture, non-bubbling, custom case, shadow DOM, exceptions | Reject unsupported names/options | Correct listener lifecycle and event contract. |
| Forms | controlled/uncontrolled transitions, IME, selection, radio, select multiple, textarea | Document as unsupported | Cross-browser controlled-value contract. |
| Refs | object, callback, callback cleanup, keyed move, conditional removal, imperative handle | Host refs and conditional cleanup work | Add keyed-move coverage, ref-as-prop, and imperative handles. |
| Failure | initial render throw, retained-row update throw, cleanup throw, nested owner throw | Root error, no leak, consistent recovery | Error boundaries and deterministic cleanup. |
| SSR | deterministic IDs, fragments, lists, escaped data, mismatch, version skew | Unsupported | Shared server/client IR and hydration protocol. |

## Immediate release gates

Before adding broad React compatibility claims:

1. Introduce accepted/rejected/different fixture manifests; make all known P0
   cases reject with spans.
2. Key React Compiler snapshots and Vidact classification by component function
   spans so multiple components and supported function forms cannot mix facts.
3. Extend the implemented direct-prop/adopted-owner ABI into a complete prop
   store and multi-root component range.
4. Extend the implemented mixed-value ranges with explicit foreign-object and
   promise diagnostics.
5. Establish nested component disposal and error recovery invariants.
6. Complete DOM event/property/style/ref behavior for the declared subset.
7. Add Firefox/WebKit, source-map, package, size, and compiler-performance gates.

## Evidence consulted

- `README.md`
- `docs/architecture/react-analysis-boundary.md`
- `docs/architecture/keyed-record-updaters-and-owned-blocks.md`
- `docs/plans/2026-08-20-1543-feat-vidact-production-rebuild-plan.md`
- `crates/vidact-compiler/src/oxc_react.rs`
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
