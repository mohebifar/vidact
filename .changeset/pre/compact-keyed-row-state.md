---
'@vidact/runtime': patch
---

Reduce retained keyed-row memory by sharing scheduler, disposer, and getter callables, allocating concurrent bookkeeping lazily, and trimming inline event metadata.
