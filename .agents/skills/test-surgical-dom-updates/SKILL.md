---
name: test-surgical-dom-updates
description: Add or review Vidact browser-corpus coverage that proves updates are surgical with MutationObserver envelopes and DOM node identity. Use when changing compiled bindings, component prop bridges, conditional ranges, keyed arrays, refs, direct DOM rendering, or when a test must distinguish an in-place update from remounting or unrelated DOM churn.
---

# Test Surgical DOM Updates

Prove the smallest expected DOM mutation surface while separately checking retained node identity.

## Workflow

1. Read `tests/browser/corpus/support/mutations.ts` and the closest existing corpus test. Reuse its exported helpers; do not create a second observer wrapper.
2. Mount the component before starting observation. Save every node whose identity matters, including unaffected siblings and keyed records.
3. Locate the actual mutable leaf with `requireSingleDirectText` when the fixture has one direct text child. It fails if there are zero or multiple candidates. Compiled binding children contain comment range markers, so `firstChild` may be a `Comment`.
4. Wrap successful updates with `captureMutations`. It supports synchronous and asynchronous actions and drains observer delivery before returning.
5. Pass the capture to `assertMutationEnvelope` with the narrowest stable rules. Prefer an exact `target`; use `within` only for an owned subtree whose internal cleanup or rendering may produce several legitimate records.
6. Assert node identity with Vitest `toBe`. For keyed reorders, compare the same saved nodes in their new order; a `childList` record alone cannot distinguish movement from remounting.
7. For an action expected to throw, start `startMutationCapture`, make the throwing assertion, then call `stop()` and assert the allowed records. `stop()` is idempotent.
8. Run the focused browser test, the full browser corpus, and browser-corpus typechecking.

## Patterns

Use an exact envelope for scalar and attribute bindings:

```ts
const text = requireSingleDirectText(element)
const capture = await captureMutations(host, () => setLabel('next'))

expect(element).toBe(originalElement)
expect(capture.records).toHaveLength(1)
expect(() => assertMutationEnvelope(capture.records, [
  { type: 'characterData', target: text },
], 'label update')).not.toThrow()
```

Allow moves inside a keyed list, then prove identity separately:

```ts
const capture = await captureMutations(host, reorder)

expect(() => assertMutationEnvelope(capture.records, [
  { type: 'characterData', within: list },
  { type: 'childList', target: list },
], 'keyed reorder')).not.toThrow()
expect(list.querySelectorAll('li')[0]).toBe(savedSecondRow)
```

Prove a rejected update is atomic:

```ts
const recorder = startMutationCapture(host)
expect(() => updateWithDuplicateKeys()).toThrow(/duplicate key/i)
expect(recorder.stop()).toEqual([])
```

## Rules

- Observe the update, never initial mounting or test-fixture construction.
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
