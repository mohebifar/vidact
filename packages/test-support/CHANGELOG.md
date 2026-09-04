# @vidact/test-support

## 0.2.0-beta.6

### Patch Changes

- @vidact/runtime@0.2.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- Updated dependencies [f7fe490]
  - @vidact/runtime@0.2.0-beta.5

## 0.2.0-beta.4

### Patch Changes

- 917f0be: Re-release CLI
- Updated dependencies [917f0be]
  - @vidact/runtime@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- 917f0be: Release vidact CLI
- Updated dependencies [917f0be]
  - @vidact/runtime@0.2.0-beta.3

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

- Updated dependencies [9b7d659]
  - @vidact/runtime@0.2.0-beta.2

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [7765e99]
  - @vidact/runtime@0.2.0-beta.1

## 0.2.0-beta.0

### Patch Changes

- Updated dependencies
  - @vidact/runtime@0.2.0-beta.0

## 0.1.0

### Minor Changes

- 807f973: Ship the initial Vidact release with prebuilt Node-API compiler bindings, the
  shared JavaScript compiler API and CLI wrapper, the Vite integration, runtime,
  testing helpers, and React-shaped TypeScript definitions.

### Patch Changes

- Updated dependencies [807f973]
  - @vidact/runtime@0.1.0
