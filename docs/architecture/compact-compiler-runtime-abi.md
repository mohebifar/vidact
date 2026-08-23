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

| Fixture | Baseline gzip | Accepted gzip | Change |
| --- | ---: | ---: | ---: |
| Counter | 9,028 B | 7,579 B | -1,449 B (-16.0%) |
| Control flow | 9,390 B | 7,905 B | -1,485 B (-15.8%) |
| Keyed list | 10,304 B | 8,708 B | -1,596 B (-15.5%) |
| TodoMVC | 12,011 B | 10,302 B | -1,709 B (-14.2%) |

The accepted runtime keeps forms, events, refs, SVG/MathML, controlled inputs,
transactional rollback, and array reconciliation available. Raw HTML remains
available under its explicit compiler feature.

The first chunk-level capability pass removes raw HTML when `unsafe-html` is
disabled while retaining recursive child validation before staging:

| Fixture | Prior accepted gzip | Feature-specialized gzip | Change |
| --- | ---: | ---: | ---: |
| Counter | 7,579 B | 6,922 B | -657 B |
| Control flow | 7,905 B | 7,239 B | -666 B |
| Keyed list | 8,708 B | 8,046 B | -662 B |
| TodoMVC | 10,302 B | 9,628 B | -674 B |

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
- Changing the private list controller itself to a tuple improved one fixture by
  one byte but regressed another; the object controller remains.

## Follow-up

The next material size project extends chunk-level DOM capability reachability
beyond raw HTML. It should let a chunk omit forms, styles, namespaces, or ref
machinery only when the compiler proves the entire chunk does not need them,
without shipping parallel JSX runtimes. Fully specialized intrinsic DOM code
generation is a second option, provided it preserves the existing production
semantics and beats the gzip baseline.
