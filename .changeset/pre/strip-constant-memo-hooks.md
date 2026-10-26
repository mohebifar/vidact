---
'@vidact/compiler': patch
---

Compile memo hooks without reactive dependencies instead of rejecting them. `useCallback` and `useMemo` calls whose factory has no reactive dependencies now unwrap to the function itself or to the factory result, so common shapes like `useCallback(() => setCount(1), [])` no longer fail with "only supported in direct compiled component declarations".
