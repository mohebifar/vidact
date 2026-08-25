# Compact compiler/runtime ABI and measured bundle budgets

**Status:** Accepted

## Context

Vidact's generated client is coupled to a private compiler/runtime ABI. The
original rebuild represented scopes, bindings, owned blocks, publication
operations, and list records as descriptive JavaScript objects. That made the
runtime easy to inspect, but every production application paid for property
names, object construction, development diagnostics, and generic source-mask
construction.

Raw or minified byte counts are not a sufficient optimization signal. Repeated
DOM construction syntax and object keys often compress well, so every change is
measured after production minification and gzip level 9 against four compiled
fixtures: a counter, control flow, a keyed list, and TodoMVC. The durable harness
is `pnpm size` under `tests/runtime-size`; checked-in per-fixture ceilings make a
gzip regression fail instead of merely printing a larger number.

## Decision

Compiler-owned values use positional representations where they do not cross a
React-shaped user API:

- compiled scopes expose add, invalidate, batch, and dispose at tuple positions
  0 through 3;
- bindings and owned structural/component results are branded tuples;
- publication operations, owners, component ranges, pending refs, staged
  values, node rollback positions, and internal keyed-list records are tuples;
- updater registration is positional instead of allocating descriptor objects;
- keyed-list result and cleanup state are internal positional records;
- ordinary generated source masks below 32 bits are emitted as numeric
  constants, while masks containing source 32 or above keep the existing
  `Uint32Array` fallback;
- components whose sources all fit below 32 bits use
  `createNarrowCompiledScope`; wide components continue to use
  `createCompiledScope`;
- generated modules select async, concurrent, and Actions runtime facades from
  the feature helpers that survive lowering, rather than from enabled feature
  flags alone, so enabling an unused family produces the exact core artifact;
- list item and index sources use their fixed numeric masks directly;
- JSX runtime calls reuse Oxc's fresh props object, ignore the runtime-only key
  argument, and skip the `children` field during intrinsic prop publication;
- production structural markers keep empty comment nodes while development
  retains descriptive marker text and symbol descriptions;
- development retains descriptive failures, while production emits stable short
  error codes.

The readable names remain in TypeScript tuple labels and exported types. The
numeric positions are private generated-code ABI, not an application authoring
surface. Wide-mask coverage is mandatory whenever narrow-mask code generation
changes.

## Measured result

Against the baseline captured before these passes:

| Fixture      | Baseline gzip | Accepted gzip |            Change |
| ------------ | ------------: | ------------: | ----------------: |
| Counter      |       9,028 B |       7,579 B | -1,449 B (-16.0%) |
| Control flow |       9,390 B |       7,905 B | -1,485 B (-15.8%) |
| Keyed list   |      10,304 B |       8,708 B | -1,596 B (-15.5%) |
| TodoMVC      |      12,011 B |      10,302 B | -1,709 B (-14.2%) |

The accepted runtime keeps forms, events, refs, SVG/MathML, controlled inputs,
transactional rollback, and array reconciliation available. Raw HTML remains
available under its explicit compiler feature.

React dependency compatibility later increased shared runtime reachability. A
measured recovery pass retained the compatibility contract while restoring
exact unused-feature equality and moving structural hydration slot discovery
behind the hydrate-only bridge:

| Fixture  | Compatibility baseline gzip | Accepted gzip | Change |
| -------- | --------------------------: | ------------: | -----: |
| Counter  |                     7,801 B |       7,571 B | -230 B |
| Actions  |                    12,117 B |      11,887 B | -230 B |
| DOM form |                     8,707 B |       8,482 B | -225 B |
| TodoMVC  |                    11,543 B |      11,347 B | -196 B |

The counter artifact is byte-identical when async, concurrent, Actions,
retained UI, profiling, or framework support is enabled but unused.

The first chunk-level capability pass removes raw HTML when `unsafe-html` is
disabled while retaining recursive child validation before staging:

| Fixture      | Prior accepted gzip | Feature-specialized gzip | Change |
| ------------ | ------------------: | -----------------------: | -----: |
| Counter      |             7,579 B |                  6,922 B | -657 B |
| Control flow |             7,905 B |                  7,239 B | -666 B |
| Keyed list   |             8,708 B |                  8,046 B | -662 B |
| TodoMVC      |            10,302 B |                  9,628 B | -674 B |

The default-core disposed-write guard intentionally spends a small part of that
margin to make retained setters and reducer dispatch fail before evaluating user
code. Reducer construction itself remains capability-imported and tree-shakes
from fixtures that use only `useState`:

| Fixture      | Feature-specialized gzip | Disposed-write guard gzip | Change |
| ------------ | -----------------------: | ------------------------: | -----: |
| Counter      |                  6,922 B |                   6,954 B |  +32 B |
| Control flow |                  7,239 B |                   7,283 B |  +44 B |
| Keyed list   |                  8,046 B |                   8,070 B |  +24 B |
| TodoMVC      |                  9,628 B |                   9,671 B |  +43 B |

Reactive host refs are default-core DOM behavior and therefore remain reachable
from direct element construction. Their staged attach/rollback/cleanup path adds
the following measured cost while staying below every accepted ceiling:

| Fixture      | Disposed-write guard gzip | Reactive-ref gzip | Change |
| ------------ | ------------------------: | ----------------: | -----: |
| Counter      |                   6,954 B |           7,080 B | +126 B |
| Control flow |                   7,283 B |           7,415 B | +132 B |
| Keyed list   |                   8,070 B |           8,213 B | +143 B |
| TodoMVC      |                   9,671 B |           9,802 B | +131 B |

Exact replacement for function-valued prop slots prevents callable props from
entering `useState` updater semantics. The extra private slot entry point has a
small default-core cost:

| Fixture      | Reactive-ref gzip | Exact prop replacement gzip | Change |
| ------------ | ----------------: | --------------------------: | -----: |
| Counter      |           7,080 B |                     7,095 B |  +15 B |
| Control flow |           7,415 B |                     7,432 B |  +17 B |
| Keyed list   |           8,213 B |                     8,236 B |  +23 B |
| TodoMVC      |           9,802 B |                     9,822 B |  +20 B |

Component commit resources let an imperative handle publish after descendant
host refs and clean up with its logical owner. The commit-marker lookup and
pending-resource queue are default-core infrastructure for the lifecycle phase:

| Fixture      | Exact prop replacement gzip | Component commit resources gzip | Change |
| ------------ | --------------------------: | ------------------------------: | -----: |
| Counter      |                     7,095 B |                         7,181 B |  +86 B |
| Control flow |                     7,432 B |                         7,516 B |  +84 B |
| Keyed list   |                     8,236 B |                         8,312 B |  +76 B |
| TodoMVC      |                     9,822 B |                         9,906 B |  +84 B |

Deferred component children reuse the structural-binding brand and insertion
path, so the thunk helper tree-shakes from chunks that do not author component
children. Resolving the receiving intrinsic's child namespace remains
default-core direct-DOM behavior:

| Fixture      | Component commit resources gzip | Deferred-child namespace gzip | Change |
| ------------ | ------------------------------: | ----------------------------: | -----: |
| Counter      |                         7,181 B |                       7,231 B |  +50 B |
| Control flow |                         7,516 B |                       7,568 B |  +52 B |
| Keyed list   |                         8,312 B |                       8,360 B |  +48 B |
| TodoMVC      |                         9,906 B |                       9,948 B |  +42 B |

Reactive spread diffing is capability-imported from a separate module. Chunks
without that compiler helper retain only the private-directive dispatch in the
direct DOM loop:

| Fixture      | Deferred-child namespace gzip | Spread directive dispatch gzip | Change |
| ------------ | ----------------------------: | -----------------------------: | -----: |
| Counter      |                       7,231 B |                        7,260 B |  +29 B |
| Control flow |                       7,568 B |                        7,597 B |  +29 B |
| Keyed list   |                       8,360 B |                        8,390 B |  +30 B |
| TodoMVC      |                       9,948 B |                        9,977 B |  +29 B |

Default-core function-boundary routing later adds one logical error-owner slot
and transaction-local failure attribution across computations, publication,
events, and effects. After subsequent lifecycle, context, root, portal, and
insertion-phase work, the measured pre-error baseline and explicit revised
ceilings are:

| Fixture      | Pre-error gzip | Error-routing gzip | Revised ceiling |
| ------------ | -------------: | -----------------: | --------------: |
| Counter      |        7,500 B |            7,725 B |         7,803 B |
| Control flow |        7,858 B |            8,082 B |         8,129 B |
| Keyed list   |        8,644 B |            8,870 B |         8,932 B |
| TodoMVC      |       10,219 B |           10,445 B |        10,526 B |

The 224-byte ceiling revision is an explicit product-contract cost for routing
all default-core failures; the lazy fallback renderer still tree-shakes from
applications that do not import it. See
`function-error-boundaries-and-root-reporting.md` for the behavior contract.

## Consequences

- Compiler and runtime changes that touch tuple positions must land together.
- Production size changes must run `pnpm size`; minified-byte improvements alone
  are insufficient.
- Narrow scopes avoid shipping wide-mask operations in ordinary applications,
  but the compiler must select the wide scope when any source ID is 32 or above.
- Private runtime structures are less convenient to inspect in built output;
  development diagnostics and labeled TypeScript types carry that readability.
- Internal tuple changes also reduce allocations and property lookups on mount
  and update paths.

## Rejected experiments

- HTML template lowering reduced generated source but did not reduce gzip.
- String-encoded DOM policy tables reduced minified bytes but increased every
  gzip fixture.
- Callable/indexed state slots either regressed a list fixture or required a
  compatibility shape that increased every fixture.
- Scanning a set of pending refs instead of mounted DOM improved asymptotic work
  but increased every measured bundle; explicit compiler-owned ref publication
  remains the intended future solution.
- A compiler-selected lean JSX runtime cut simple fixtures to roughly 3.9–5.2 KB
  gzip, but per-file selection duplicated the lean and full runtimes in mixed
  chunks and increased TodoMVC by 230 B. Feature specialization must therefore
  be selected per final chunk or built on a single shared core before it can be
  accepted.
- Moving compiled-renderable recognition behind a generic installer reduced the
  protocol module itself by 126 rendered bytes, but increased counter gzip by
  4 B and TodoMVC by 10 B. Optional capability boundaries must reduce the final
  compressed chunk, not merely an isolated module.
- Changing the private list controller itself to a tuple improved one fixture by
  one byte but regressed another; the object controller remains.

## Follow-up

The next material size project extends chunk-level DOM capability reachability
beyond raw HTML. It should let a chunk omit forms, styles, namespaces, or ref
machinery only when the compiler proves the entire chunk does not need them,
without shipping parallel JSX runtimes. Fully specialized intrinsic DOM code
generation is a second option, provided it preserves the existing production
semantics and beats the gzip baseline.
