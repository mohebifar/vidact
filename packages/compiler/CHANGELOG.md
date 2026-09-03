# @vidact/compiler

## 0.2.0-beta.4

### Patch Changes

- 917f0be: Re-release CLI

## 0.2.0-beta.3

### Patch Changes

- 917f0be: Release vidact CLI

## 0.2.0-beta.2

### Patch Changes

- 9b7d659: Build every package with `tsdown` in unbundle mode instead of `tsc` plus two
  repository scripts. `dist` still mirrors `src` file for file, with the same entry
  points, ESM output, declarations, declaration maps, and source maps, and the
  runtime's tree-shaking budgets are unchanged. The Vidact Start ambient route
  module ships as written so it stays an ambient declaration rather than a module
  augmentation.

  Packages now publish their `src` directory, so the shipped source maps and
  declaration maps resolve. Vite no longer reports "points to missing source
  files" for Vidact modules, debugging steps into real TypeScript, and go-to-
  definition lands on the source rather than the declaration.

## 0.2.0-beta.1

### Minor Changes

- 7765e99: Compile React-shaped dependency capsules into retained intrinsic owners, expand
  the supported shadcn Base UI corpus, add target-specific JSX/server-edge facades,
  preserve loader-thrown Web responses, and ship the React-free Vidact Start plus
  headless Fumadocs docs starter with a native Popover proof.

## 0.2.0-beta.0

### Minor Changes

- Add compiled renderable capabilities and React dependency compilation support.

## 0.1.0

### Minor Changes

- 807f973: Ship the initial Vidact release with prebuilt Node-API compiler bindings, the
  shared JavaScript compiler API and CLI wrapper, the Vite integration, runtime,
  testing helpers, and React-shaped TypeScript definitions.
