# React Compiler analysis spike

Status: **proven for the bounded corpus; not production-ready**

This spike answers one question: can Vidact reuse the Rust/OXC React Compiler analysis pipeline without adopting its code generator or runtime? Yes. A small fork can capture owned def-use and optimized-scope snapshots without applying React codegen.

## Decision

Vendor `oxc_react_compiler` for the spike and maintain a deliberately narrow patch. The published `0.143.0` crate provides `compile` and `lint`, but its pipeline modules and optimized `ReactiveFunction` are private. Installing it unchanged cannot expose the analysis result Vidact needs. Reimplementing the entire analysis on `oxc_semantic` would discard the hardest and most valuable parts of React Compiler: control-flow lowering, SSA, effects, alias analysis, and reactive dependency inference.

| Option | Access to React analysis | Maintenance | Upstream drift | Spike verdict |
| --- | --- | --- | --- | --- |
| Published dependency | No private pre-codegen IR | Low | Low | Insufficient API |
| Vendored OXC React Compiler | Full, with a small local seam | Medium | Must rebase deliberately | Chosen |
| Rewrite on OXC semantic | Only syntax, scopes, and symbols initially | Very high | Independent | Wrong starting point |

The vendored source is pinned to `oxc_react_compiler 0.143.0` and requires Rust 1.95 or newer. The workspace toolchain is 1.96.0.

## Architecture proven

```mermaid
flowchart LR
    A["TSX source"] --> B["OXC parser + semantic model"]
    B --> C["React Compiler HIR + SSA + effects"]
    C --> D["Optimized reactive scopes"]
    D --> E["Owned pre-codegen snapshot"]
    E --> F["Vidact DOM classification"]
    F --> G["ComponentFacts"]
    G --> H["Vidact static updater IR"]
```

The fork adds owned function, scope, dependency, instruction, and value records. No arena reference, React HIR node, or OXC AST node crosses the crate boundary. Local value IDs are copied as plain integers so Vidact can follow unnamed SSA temporaries without depending on React Compiler's index types.

The seam has two capture moments. Def-use instructions are copied immediately before `prune_unused_lvalues`, because that optimization deliberately erases source binding lvalues that Vidact still needs to connect `count -> doubled`. Optimized reactive scopes are copied after pruning, merging, stable block IDs, renaming, and hoisted-context pruning. The two owned views are combined into one `FunctionAnalysis` before React codegen.

The final scope capture occurs after these important passes:

- reactive-scope dependency propagation;
- non-escaping, unused, and non-reactive scope pruning;
- invalidation-scope merging;
- lvalue pruning and temporary promotion;
- destructuring declaration extraction;
- stable block IDs and variable renaming;
- hoisted-context pruning.

The owned snapshot is assembled before React Compiler codegen. Vidact neither applies the compiled replacement nor imports the React memo-cache runtime.

## Corpus result

Three browser-oriented TSX shapes lower to the existing `ComponentFacts` contract:

| Fixture | Facts demonstrated |
| --- | --- |
| `Counter` | `useState` source, derived `count -> doubled` edge, text updater |
| `Greeting` | destructured prop, derived message, text and attribute updaters |
| `Todos` | array state and keyed structural updater using `item.id` |

The tests execute the real OXC parser, OXC semantic builder, and vendored React Compiler pipeline. The counter's `count -> doubled` edge is recovered through React Compiler's def-use chain, including unnamed temporaries, rather than lexical identifier matching. A fixture rejected by any stage returns an `AnalysisFailed` diagnostic rather than silently falling back. The bounded adapter also fails closed when a module contains multiple components, until the DOM classifier is scoped using OXC function spans.

## What React Compiler gives Vidact

React Compiler's reactive scopes answer which values must be recomputed together and which declarations depend on which inputs under JavaScript control-flow and mutation semantics. That is substantially stronger than Vidact 2020's updater discovery, which inferred dependencies from local syntax and generated direct assignment callbacks.

It does **not** answer which exact DOM node property should be updated. React Compiler targets React memoization, so a JSX expression is still a React value-producing operation. Vidact must supply a second, smaller analysis that classifies JSX bindings as text, attributes, properties, branches, effects, or keyed lists.

This is also why React Compiler scopes are not the same thing as signals. They are compile-time dependency and invalidation facts. Vidact can lower them into static updater functions without shipping signal objects, subscriber sets, or a virtual DOM.

## Spike limitations

The current Vidact DOM classifier is intentionally a corpus probe, not a parser replacement. It recognizes a constrained set of source shapes using lexical extraction after React Compiler has accepted the module:

- named function components;
- destructured props;
- direct `useState` array destructuring;
- simple `const` derived values;
- JSX expression text and attributes;
- direct `collection.map(...)` with a property key.

It does not yet correctly handle aliases, shadowing, nested functions, computed keys, fragments with mixed update sites, conditional trees, arbitrary destructuring, multiple returns, optional chaining, or source transforms. The keyed-array test proves the intended IR boundary, not a production list reconciler.

## Production path

Keep the React Compiler fork limited to snapshot capture, then replace the lexical Vidact classifier with an OXC AST visitor backed by `oxc_semantic` symbol and reference IDs. The production adapter should:

1. map React Compiler snapshot names and spans to OXC symbols without relying on strings;
2. assign stable source IDs for props, state, context, derived values, and external reads;
3. classify every JSX expression container by its parent position;
4. lower conditions into branch updaters and arrays into keyed structural regions;
5. reject unkeyed or unstable-key list shapes with precise source diagnostics;
6. snapshot the normalized facts rather than private React HIR;
7. add upstream-version conformance tests before each vendor update;
8. measure compiler binary size, compile latency, generated JavaScript size, and runtime allocation count.

For a production dependency strategy, first propose the owned snapshot API upstream. Until such an API is accepted, the vendored fork is the most robust route because the patch is small, explicit, and tested at the exact seam Vidact needs.
