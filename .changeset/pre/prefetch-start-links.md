---
'@vidact/start': patch
---

Prefetch routes on intent. `Link` now fetches the destination's snapshot and route modules when the pointer rests on it for 50 ms, when it receives focus, or when it is pressed, and the following click reuses that snapshot for up to 30 seconds. Hover and focus prefetching pause while the browser's data saver is on. Opt a link out with `prefetch="none"`, or prefetch from code with `client.prefetch(to)`. Navigations also start downloading route modules alongside the snapshot request instead of after it.
