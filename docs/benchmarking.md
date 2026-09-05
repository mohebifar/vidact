# Benchmarking

Vidact's benchmark gates are regression smoke tests for this repository. They
do not establish comparative framework performance.

## Compiler and scheduler benchmark

Run `pnpm benchmark`. The command builds the published package entries, starts
Node with `--expose-gc`, and prints one JSON report containing the Node version,
platform, architecture, fixture byte sizes, raw samples, sampling method, and
budgets.

The fixed compiler corpus contains the counter, structured control-flow, and
keyed-list runtime-size fixtures. For each file the benchmark records:

- one cold transform;
- 20 unchanged-source cache hits;
- 20 changed-source transforms at the same filename, using a unique trailing
  block comment for each revision; and
- one cache hit for the last changed revision.

The report uses the nearest-rank median and p95 for repeated samples. Retention
uses a separate plugin instance, compiles 10 warmup revisions and 100 measured
revisions for each fixture, runs explicit garbage collection before and after
the measured revisions, and reports the positive JavaScript heap delta. The
Vite cache unit test separately proves that only the latest revision occupies a
module/configuration slot.

The scheduler section measures reverse-registered sparse chains of 64, 256, and
1,024 updaters five times each. A second sample removes, replaces, and flushes
one updater in a 256-updater graph 100 times. Both workloads assert the exact
number of updater executions before reporting their time.

## Browser runtime budget

`packages/runtime/test/performance/runtime-budgets.browser.test.ts` runs in
Chromium, Firefox, and WebKit. It retains the existing 100-mount/2,000-update
owner budget and adds a 1,000-row keyed workload. The keyed workload alternates
20 times between overlapping ascending and descending key sets, retains 750
records per transition, creates and disposes exactly 250, and asserts a shared
row's node identity before checking elapsed time.

## Thresholds

| Measurement | Ceiling | Purpose |
| --- | ---: | --- |
| Cold transform | 10,000 ms | Allows native compiler startup while catching hangs and extreme regressions. |
| Unchanged-source p95 | 50 ms | Guards the cache-hit path independently of compilation. |
| Changed-source p95 | 250 ms | Guards actual same-module recompilation with substantial host variance. |
| Post-revision cache hit | 50 ms | Proves the replacement revision becomes the reusable entry. |
| Changed-revision heap growth | 32 MiB | Catches edit-history retention after warmup and explicit GC. |
| 1,024-updater ordering p95 | 20 ms | Keeps sparse graph construction well below a frame on the reference host, with headroom for CI variance. |
| 256-updater/100-change churn | 50 ms | Guards repeated topology invalidation and recomputation. |
| Browser mount/update workload | 5,000 ms | Broad cross-engine smoke ceiling paired with owner and DOM correctness. |
| Browser keyed-list workload | 5,000 ms | Broad cross-engine smoke ceiling paired with exact reuse/create/dispose assertions. |

Timing ceilings intentionally have more headroom than the repository's normal
results because shared CI hosts are noisy. Correct output, React-free code,
owner retention, keyed identity, updater execution counts, and `pnpm size`
remain independent gates; a faster incorrect result cannot pass.
