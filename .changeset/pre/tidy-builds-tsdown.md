---
'@vidact/compiler': patch
'@vidact/runtime': patch
'@vidact/start': patch
'@vidact/test-support': patch
'@vidact/vite': patch
---

Build every package with `tsdown` in unbundle mode instead of `tsc` plus two
repository scripts. `dist` still mirrors `src` file for file, with the same entry
points, ESM output, declarations, declaration maps, and source maps, and the
runtime's tree-shaking budgets are unchanged. The Vidact Start ambient route
module ships as written so it stays an ambient declaration rather than a module
augmentation.

Packages now publish their `src` directory, so the shipped source maps and
declaration maps resolve. Vite no longer reports "points to missing source
files" for Vidact modules, debugging steps into real TypeScript, and go-to-
definition lands on the source rather than the declaration.
