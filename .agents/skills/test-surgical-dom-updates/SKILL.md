---
name: test-surgical-dom-updates
description: Add or review Vidact end-to-end browser-corpus coverage using React-shaped TSX mini apps compiled by the Vidact Vite plugin, with MutationObserver envelopes and DOM node identity proving surgical updates. Use when changing compiled bindings, component prop bridges, conditional ranges, keyed arrays, refs, direct DOM rendering, or when a test must distinguish an in-place update from remounting or unrelated DOM churn.
---

# Test Surgical DOM Updates

Prove the smallest expected DOM mutation surface in a real compiled mini app while separately checking retained node identity.

## Workflow

1. Add the scenario under `tests/browser/corpus/apps/<app>/`. Write a React-shaped `.tsx` component that imports supported APIs from `react`; do not construct runtime bindings directly.
2. Import that `.tsx` component from a colocated `.browser.test.ts`. The browser Vitest config's `vidact()` plugin must compile it through `@vidact/vite` and the Rust compiler. Mount it with `mountCompiled` and drive state changes through DOM events.
3. Read `packages/test-support/src/mutations.ts` and the closest compiled app test. Import its helpers from `@vidact/test-support`; do not create a second observer wrapper.
4. Mount before observing. Save every node whose identity matters, including unaffected siblings and keyed records.
5. Locate a mutable leaf with `requireSingleDirectText` when it has one direct text child. Compiled binding children contain comment range markers, so `firstChild` may be a `Comment`.
6. Wrap successful interactions with `captureMutations`. It supports synchronous and asynchronous actions and drains observer delivery before returning.
7. Pass records to `assertMutationEnvelope` with the narrowest stable rules. Prefer an exact `target`; use `within` only for an owned subtree whose internal cleanup or rendering may produce several legitimate records.
8. Assert node identity with Vitest `toBe`. For keyed reorders, compare saved nodes in their new order; a `childList` record alone cannot distinguish movement from remounting.
9. For an action expected to throw, start `startMutationCapture`, make the throwing assertion, then call `stop()` and assert the allowed records. `stop()` is idempotent.
10. Keep direct-runtime tests as focused infrastructure coverage, never as a replacement for a compiled app regression. Run the focused browser test, full browser corpus, and browser-corpus typechecking.

## Patterns

Use an exact envelope for scalar and attribute bindings:

```ts
const text = requireSingleDirectText(element)
const capture = await captureMutations(host, () => increment.click())

expect(element).toBe(originalElement)
expect(capture.records).toHaveLength(1)
expect(() => assertMutationEnvelope(capture.records, [
  { type: 'characterData', target: text },
], 'label update')).not.toThrow()
```

Allow moves inside a keyed list, then prove identity separately:

```ts
const capture = await captureMutations(host, () => reverse.click())

expect(() => assertMutationEnvelope(capture.records, [
  { type: 'characterData', within: list },
  { type: 'childList', target: list },
], 'keyed reorder')).not.toThrow()
expect(list.querySelectorAll('li')[0]).toBe(savedSecondRow)
```

For a lower-level runtime test, prove a rejected update is atomic:

```ts
const recorder = startMutationCapture(host)
expect(() => updateWithDuplicateKeys()).toThrow(/duplicate key/i)
expect(recorder.stop()).toEqual([])
```

## Rules

- Observe the update, never initial mounting or test-fixture construction.
- Exercise public React-shaped source through the Vite plugin. A generated JavaScript fixture or direct runtime setup alone is not corpus-level E2E evidence.
- Trigger behavior through browser-visible events where a user could do so; avoid reaching into compiled closures or calling runtime setters from app-corpus tests.
- Default to the helper's full subtree configuration: attributes, character data, and child lists with old values.
- Treat zero records as the correct envelope for a no-op update.
- Avoid asserting record order unless updater ordering is itself the contract.
- Assert exact record counts only when the platform operation has a stable count; keyed movement may emit multiple removal/addition records.
- Keep cleanup mutations inside the disposed owned subtree in the allowed envelope when branch disposal intentionally tears down nested ranges before removing the branch root.
- Do not use `innerHTML` equality as proof of surgical behavior; replacement can produce identical markup.
- Do not infer more than the observer sees. Property writes such as `input.value`, event-listener changes, ref callbacks, updater execution counts, and scope disposal need separate assertions.
- Preserve tests that demonstrate intentionally non-surgical compatibility behavior; do not falsely label full rerenders as compiled surgical updates.

## Verification

Run:

```sh
pnpm --filter @vidact/browser-corpus typecheck
pnpm --filter @vidact/browser-corpus test
```

If the browser server cannot bind inside the sandbox, request the normal browser-test permission rather than changing Vitest configuration.
