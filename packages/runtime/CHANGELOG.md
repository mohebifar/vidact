# @vidact/runtime

## 0.2.0-beta.5

### Patch Changes

- f7fe490: Hydration fixes for server-rendered content the client cannot reproduce immediately.

  - Keep hydration markers out of raw-text elements. The server no longer emits `<!--vidact:v1:*-->` comments inside `<textarea>`, `<title>`, `<script>` and `<style>`, where the HTML parser turned them into literal text that stayed visible until hydration recovered from the mismatch. The hydrator synthesizes those markers around the element's parsed text node instead, so such elements hydrate in place.
  - Dehydrated Suspense boundaries. When a Suspense child suspends while hydrating server-rendered content — a `lazy` chunk that has not loaded yet, for example — the boundary now keeps the server DOM on screen and swaps in the client render once the resource resolves, instead of publishing the fallback over it, mismatching, and re-mounting the whole root.
  - `@vidact/start` renders the route tree inside a root component on the server. The client mounts the application under a compiled root of its own, which claims a component marker range; without a matching server root every client component claimed the range of the _next_ server component, which surfaced as a hydration mismatch (and a visible fallback flash) on any route whose component has more than one return.
  - `hydrateStart` accepts `onRecoverableError`, and warns on the console by default when hydration has to recover by re-rendering. A silent recovery looks like a working page that merely flashes.
  - Hydration mismatch messages describe the element (`DIV.class[data-x]`) instead of just its tag.
  - Element claiming no longer prefers a candidate that contains an array marker unless the pending structural child is a list. A conditional or Suspense child triggered the same bias, so a class-less wrapper `<div>{cond ? <A/> : <B/>}</div>` could claim an unrelated sibling that happened to hold a keyed list.

  - Hydration marker protocol `v2`. The server no longer wraps intrinsic elements (`s`) or scalar text (`t`) in marker comments — inside a child slot an element can only be the intrinsic child and a text node the scalar, so the hydrator infers them, splitting a text node that adjacent scalars parsed into. A scalar binding borrows its child-slot markers as its range (no DOM writes) and only creates anchor comments where there is nothing to borrow, such as inside `<textarea>`. The prefix shrank from `vidact:v1` to `v2`; together this removes about 40% of markers and 60% of marker bytes from server HTML. A `v1` render is rejected by a `v2` client and re-rendered, and vice versa.

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
