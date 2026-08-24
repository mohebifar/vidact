# React-shaped JSX type package

- Decision state: Accepted
- Decided: 2026-08-22
- Amended: 2026-08-23 — every handler target is non-null and specializes to
  its intrinsic element
- Amended by: [Namespace-aware DOM semantics](namespace-aware-dom-semantics.md)

## Context

The browser corpus and TodoMVC each carried a local `vidact.d.ts`. Those copies
declared every intrinsic element as `Record<string, unknown>`, so misspelled or
element-inappropriate attributes type-checked and event parameters had no
contextual type. They also duplicated Vidact's `JSX.Element`, `useState`, and
`useRef` declarations.

React already maintains a comprehensive HTML, SVG, ARIA, style, ref, and DOM
attribute model in `@types/react`. Vidact needs that syntax coverage without
claiming that its compiled values are React element descriptors or that its
runtime dispatches React synthetic events.

## Decision

`@vidact/react-types` is the single package for React-shaped Vidact source
types. Consumers load its ambient declarations through `compilerOptions.types`
and set `jsxImportSource` to the package while preserving TSX for the Vidact
compiler.

The package derives namespace-safe HTML element props from
`React.JSX.IntrinsicElements`. It preserves the React definitions for HTML,
ARIA, style, `key`, and `ref` attributes, then applies these Vidact-specific
adaptations:

- `JSX.Element` is `CompiledComponentResult`, the single-mount owned range
  produced by compiled components.
- Intrinsic `children` accept `VidactNode`, an alias of the runtime's
  `CompiledRenderValue`, rather than `ReactNode`.
- `on*` attributes receive native DOM events with an element-specific
  `currentTarget`, because the direct DOM runtime uses `addEventListener` and
  does not construct synthetic events. Their `target` is non-null while the
  listener runs and specializes to the intrinsic element for every event,
  allowing direct element-specific property access without casts.
- `on*Capture` attributes register the same native event in the capture phase;
  the phase suffix is not part of the DOM event name.
- `dangerouslySetInnerHTML` preserves React's `{ __html: string | TrustedHTML }`
  shape. The compiler and runtime enforce its opaque-subtree restrictions; the
  type package does not claim sanitization.
- React-only hydration warnings and function-valued form actions are omitted;
  the direct DOM runtime neither hydrates nor invokes React server actions.
- SVG intrinsic names reuse React's typed surface. MathML uses a bounded
  Vidact-owned attribute interface because the pinned `@types/react` release
  does not declare MathML intrinsics. Compiler lowering carries namespace
  context through nested elements and compiled component boundaries.
- Hyphenated custom elements retain an open attribute surface until Vidact has
  a custom-element attribute registry. Their event handlers infer `Element` as
  the narrowest type available without that registry.

`useState`, `useRef`, and ordinary React utility types come directly from
`@types/react`; the shared package does not redeclare the `react` module.
`useState` remains compiler syntax and is erased during lowering, while
`useRef` resolves to the Vite plugin's runtime bridge.

## Compiler and runtime contract

The package controls TypeScript's source-level JSX contract only. It does not
add a React runtime, React element objects, reconciliation, or dynamic hook
execution. `@vidact/react-types/jsx-runtime` forwards to the direct DOM runtime
if a tool resolves that subpath, while Vidact's production Vite compilation
continues to emit `@vidact/runtime/jsx-runtime` imports.

Type acceptance is not a substitute for compiler compatibility analysis. The
Rust compiler remains responsible for accepting or rejecting React-shaped
syntax, and the runtime remains responsible for native DOM application and
owned-range lifecycle. In particular, using a type from `@types/react` does not
promise every React behavior associated with that type.

## Invariants

- There is one checked-in Vidact JSX declaration source, owned by
  `@vidact/react-types`; apps and tests do not carry local `vidact.d.ts` copies.
- Standard HTML intrinsic attributes are checked against `@types/react`, not a
  catch-all string index.
- JSX expressions and explicit `JSX.Element` annotations resolve to
  `CompiledComponentResult`, never `ReactElement`.
- Renderable component props use `VidactNode`, not `ReactNode`.
- Event callbacks are typed as the native events the runtime dispatches.
- Event callback targets are non-null during dispatch and expose their
  intrinsic HTML, SVG, or MathML element type without a cast; open custom
  elements expose `Element`.
- Accepted intrinsic element names have native HTML, SVG, or MathML namespace
  construction according to their compiler-carried host context.
- Type-only dependencies do not add React to the browser bundle.

## Alternatives considered

- **Keep app-local ambient declarations:** avoids a package, but duplicates a
  public contract and leaves intrinsic attributes effectively untyped.
- **Use `@types/react` unchanged:** supplies excellent DOM coverage, but makes
  JSX produce `ReactElement`, children accept React descriptors, and handlers
  receive synthetic-event types that Vidact does not implement.
- **Copy React's intrinsic definitions:** gives full control but creates a large
  maintenance fork and delays fixes from DefinitelyTyped.
- **Redeclare the `react` module:** can narrow hooks and `ReactNode`, but shadows
  reusable React utility types and conflicts with normal module augmentation.

## Consequences

Vidact source gets current React-quality intrinsic attribute checking without a
runtime React dependency or copied DOM declarations. Consumers must install a
compatible `@types/react` peer and configure `jsxImportSource`. Props that carry
compiled children must use `VidactNode`; existing code that uses `ReactNode` for
that purpose must migrate.

The adapter intentionally has a small maintenance surface: child values,
events, unsupported React-only props, namespaces, custom elements, and compiled
element identity.
When Vidact adds or rejects another React attribute behavior, this package must
be updated alongside compiler/runtime tests rather than broadening types with a
catch-all escape hatch.

## Verification

- `packages/react-types/test/jsx-contract.tsx` covers typed HTML, SVG, and
  MathML attributes, native event inference, custom elements, invalid native
  attributes, rejected React-only props, and compiled-element identity.
- `tests/browser/tsconfig.json` and `examples/todomvc/tsconfig.json` prove the
  shared package can type-check real React-shaped Vidact applications.
- Run `pnpm --filter @vidact/react-types typecheck`,
  `pnpm --filter @vidact/browser-corpus typecheck`, and
  `pnpm --filter @vidact/example-todomvc typecheck`.
