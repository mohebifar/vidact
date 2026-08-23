# no-action-reset-event-dependency

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning

## Why

After a function-valued form Action succeeds, Vidact resets uncontrolled fields
with an owned routine that preserves compiled DOM nodes and binding markers. It
does not call native `form.reset()`, so the automatic Action reset does not
dispatch a `reset` event. Code that expects `onReset` to observe successful
Action completion will not run.

## Incorrect

```tsx
function Editor() {
  async function save(data: FormData) {
    await persist(data)
  }

  return <form action={save} onReset={() => analytics.track("saved-and-reset")} />
}
```

## Preferred

```tsx
function Editor() {
  async function save(data: FormData) {
    await persist(data)
    analytics.track("saved-and-reset")
  }

  return <form action={save} />
}
```

Observe Action settlement in the Action itself. Keep `onReset` only for reset
buttons or explicit native reset operations initiated by application code.

## Proposed check

Report an intrinsic `<form>` that combines a non-string `action` expression with
an `onReset` handler. The diagnostic should explain that the handler still sees
native user or application resets but does not see Vidact's successful Action
reset.

## False positives and configuration

The handler may intentionally observe only a reset button or an explicit
`form.reset()` call. The future rule needs a focused suppression for that intent
and should not report URL-valued form actions.

## Compiler boundary

Both props are valid and the form remains correct: fields reset without losing
compiled ownership, while independently initiated native reset events still
work. Whether the handler is meant to observe Action completion is not provable,
so this is a warning rather than a compilation error.

## Evidence

See [Compiled Actions and owned form reset](../architecture/compiled-actions-and-owned-form-reset.md)
for the ownership decision. The owned reset is implemented in
`packages/runtime/src/dom/forms.ts` and exercised across three browsers by
`packages/runtime/test/actions/actions.browser.test.ts`.
