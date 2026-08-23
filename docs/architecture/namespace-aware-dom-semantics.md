# Namespace-aware DOM semantics

- Decision state: Accepted
- Decided: 2026-08-22
- Amends: [React-shaped JSX type package](react-shaped-jsx-type-package.md)

## Context

The direct JSX runtime previously called `document.createElement` for every
intrinsic, treated any matching DOM property as the write policy, merged style
objects with `Object.assign`, and mapped `onChange` to the native `change`
event. Valid React-shaped source could therefore compile while producing XHTML
SVG/MathML nodes, stale styles, missing boolean ARIA/data values, incorrect
property resets, or unusable controlled text inputs. These are silent semantic
failures, so diagnostics alone are not an acceptable boundary.

Because automatic JSX evaluates child calls before their parent call, the
runtime cannot infer an SVG child's namespace from physical DOM ancestry. The
compiler must carry the static JSX namespace without introducing a React
element descriptor or Virtual DOM.

## Decision

Vidact owns a bounded React-shaped intrinsic DOM policy split across compiler
lowering and small runtime modules:

- Compiler lowering annotates nested JSX with the private
  `__vidactNamespace` construction prop. SVG and MathML descendants retain
  their namespace across compiled component calls; children of SVG
  `foreignObject` reset to HTML. Intrinsic JSX authored as a component child is
  rejected until the compiler can defer its construction: the component may
  insert that child across an HTML, SVG, MathML, or `foreignObject` boundary
  that is unknowable at the call site.
- The JSX runtime consumes that private prop before user component props are
  formed and calls `createElementNS` for SVG and MathML. It never writes the
  private prop to live DOM.
- SVG aliases and `xlink*`/`xml*` names use namespace-aware attribute
  operations. MathML names remain in the MathML namespace.
- ARIA and `data-*` values stringify booleans. `null` and `undefined` remove
  the attribute.
- HTML boolean, booleanish-string, and overloaded-boolean attributes have
  distinct policies. Nullish ordinary props remove their reflected attribute
  instead of assigning the generic value `false`.
- Style objects remember their previously applied keys, remove omitted keys,
  serialize numeric dimensions, and support CSS custom properties.
- Capture handlers use the native capture phase. Listener replacement and
  removal remain owner-cleaned compiled prop transitions.
- `onChange` keeps native `Event` objects but adopts React-shaped timing:
  `input` for text-like input/textarea and `change` for select, checkbox,
  radio, and file inputs. The target classifier also applies when the handler
  is registered on an ancestor.
- Controlled `value` and `checked` writes avoid redundant assignments and are
  restored synchronously after managed form handlers and normal native event
  propagation. A microtask remains only as a fallback for unmanaged or stopped
  native dispatch. Multiple selects accept array values, apply selection after
  their options are inserted, and publish mode changes before values.

## Compiler and runtime contract

`crates/vidact-compiler/src/surgical_codegen/namespace.rs` is the only producer
of the private namespace prop. A source-authored prop with the same name is a
compiler error. When an accepted JSX element contains a spread, the compiler
also appends its own namespace marker after the spread; an explicit `inherit`
marker protects root and component-context elements without overriding their
caller-provided context. The annotation is construction metadata, not a
reactive source and not a DOM dependency.

`packages/runtime/src/direct-dom.ts` retains direct, one-time node construction.
Namespace, property, style, form, and event behavior lives under
`packages/runtime/src/dom/`; none of those modules stores a render tree or
performs reconciliation. Each compiled scope captures its construction
namespace. Scope updaters and owned structural mounts restore that namespace,
so a conditional or list item created later remains in its caller's SVG or
MathML context.

Vidact does not synthesize React events. Handler values are browser events with
a native `currentTarget`. This slice also does not claim React's development
warnings for controlled/uncontrolled transitions, event delegation,
hydration-time form restoration, or full IME and selection parity across all
browsers. Those remain explicit compatibility work, not reasons to fall back
to component replay.

## Invariants

- Every accepted intrinsic is constructed in the namespace selected by its JSX
  host context, including across compiled component boundaries.
- JSX intrinsic children are not eagerly passed into components; this unsafe
  form fails compilation pending lazy, namespace-aware owned children.
- SVG `foreignObject` children are HTML; the `foreignObject` itself is SVG.
- Namespace metadata is never visible to a user component or live element.
- Removing a style key removes its live declaration without replacing the
  element.
- `aria-*={false}` and `data-*={false}` produce the string `"false"`.
- Capture handlers run in capture order and owner disposal removes the exact
  phase-specific listener.
- A normal controlled text edit publishes from `input`, including through an
  ancestor `onChange`; an unaccepted edit restores the last compiled value
  before managed dispatch returns, including when its handler stops propagation.
- These updates preserve the intrinsic node's identity.

## Alternatives considered

- **Infer namespace from the parent during append:** child JSX calls have
  already created their nodes, and recreating them would lose listeners, refs,
  state, and identity.
- **Return lazy intrinsic descriptors:** would reintroduce a runtime element
  tree solely to defer construction, conflicting with Vidact's direct-DOM
  architecture.
- **Treat every matching DOM property uniformly:** reflected, boolean,
  namespaced, form-live, and custom-element properties have different reset
  semantics; one generic assignment rule is observably incorrect.
- **Keep native `change` timing as an intentional difference:** controlled text
  inputs are too central to React-shaped applications for that difference to be
  production-safe.

## Consequences

The compiler gains a small DOM-specific JSX annotation pass, while React
Compiler remains DOM-agnostic. Runtime code is larger than the previous generic
setter but tree-shakeable by concern and far less risky than silent DOM
miscompilation. MathML types require a small Vidact-owned attribute interface
because the pinned `@types/react` version has no MathML intrinsic declarations.

The supported contract is now strong enough for ordinary SVG, MathML, styles,
capture handlers, and controlled form use. Cross-browser IME, selection, form
reset, unusual non-bubbling events, and controlled/uncontrolled warning parity
remain roadmap items.

## Verification

- `tests/browser/corpus/apps/dom-semantics/DomSemanticsApp.browser.test.ts`
  compiles a React-shaped mini app and proves namespaces, component-boundary
  propagation including delayed branches, `foreignObject`, namespaced
  attributes, style deletion, ARIA/data values, property removal, capture
  order, ancestor change timing, handler-free controlled restoration, textarea,
  checkbox, external form-associated radio, and single/multiple select behavior
  while retaining node identity.
- `packages/runtime/test/reactivity/direct-dom.browser.test.ts` covers the
  direct construction and capture infrastructure.
- `packages/react-types/test/jsx-contract.tsx` covers HTML, SVG, MathML, and
  native-event source types.
- Run `pnpm --filter @vidact/runtime test`,
  `pnpm --filter @vidact/browser-corpus test`, and
  `pnpm --filter @vidact/browser-corpus typecheck`.
