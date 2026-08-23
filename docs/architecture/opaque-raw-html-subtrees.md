# Opaque raw HTML subtrees

- Decision state: Accepted
- Decided: 2026-08-22
- Superseded in part by: [Versioned compiler targets and feature gates](versioned-compiler-targets-and-feature-gates.md)

## Context

Vidact previously rejected `dangerouslySetInnerHTML` in the direct DOM runtime
and omitted it from the React-shaped JSX types. Treating it as an ordinary DOM
property would be incorrect: replacing `innerHTML` can destroy compiler-owned
children, event cleanup records, refs, list records, and component owners. It
is also an injection sink whose behavior changes under Trusted Types CSP.

## Decision

`dangerouslySetInnerHTML` is supported on HTML host elements as an explicit
opaque-subtree boundary. Markup inside that boundary is browser-parsed DOM, not
Vidact-owned JSX: the compiler creates no bindings, refs, component scopes, or
list records inside it.

This support now requires the `unsafe-html` compiler feature. The remainder of
this decision defines the behavior after that feature is enabled.

The source contract follows React where the browser runtime can preserve the
same semantics:

- the value must be an object with an inherited or own `__html` property;
- a nullish prop is a no-op; a nullish `__html` payload is a no-op on ordinary
  hosts;
- a non-null payload and non-null `children` are mutually exclusive;
- void elements and `textarea` reject any non-null raw HTML prop object, even
  when its `__html` payload is nullish;
- payload comparison is strict identity/value equality, so a new wrapper around
  the same string does not replace descendant nodes;
- an empty string removes every opaque descendant;
- replacing the payload intentionally discards descendant node identity.

The compiler reports the invalid shape, child conflict, invalid host, or
executable script target only when the effective JSX attribute order proves it.
Later spreads, component props, nullable expressions, and otherwise unknown
values defer to runtime checks instead of producing false positives.

## Compiler and runtime contract

Reactive raw HTML is a compiled prop transition. Evaluation and contextual
parsing happen before live publication. The runtime parses with a matching host
tag in an inert HTML document, keeps `template.content` as the template's real
container, and uses a neutral `div` context for autonomous custom-element hosts
so staging does not construct the host a second time.

Raw HTML transitions publish after ordinary host prop/event operations. At
commit, staged nodes are adopted into the live document and custom elements are
upgraded, then the opaque container is replaced. The previous node objects are
retained as the inverse until the publication succeeds. A prior setter failure
therefore produces no raw-subtree mutation; a later failure can restore the
same previous node objects.

DOM rollback cannot undo user-code side effects. If a raw transition commits
and a later transition fails, newly upgraded custom elements may observe one
`connectedCallback` followed by `disconnectedCallback` before the previous
nodes are reconnected. Vidact restores DOM ownership and identity, but it does
not pretend constructors, callbacks, or other imperative effects never ran.

Strings and `TrustedHTML` values are passed to the browser's `innerHTML` sink
without framework string coercion. Vidact does not sanitize strings, create a
Trusted Types policy, or weaken CSP. Under `require-trusted-types-for 'script'`,
an untrusted string fails during detached parsing before the live DOM changes;
applications supply a policy-created `TrustedHTML` value when their CSP demands
one.

## Invariants

- A raw HTML host never also owns a non-null compiled child.
- Equivalent `__html` payloads retain the exact descendant node objects.
- Parsing or validation failure leaves the live subtree untouched.
- A failing earlier publication operation cannot expose staged raw nodes or
  construct staged custom elements.
- Replacing a payload mutates only the opaque host's child list.
- Raw markup is never interpreted as Vidact JSX, even if it resembles compiler
  markers or component output.
- Trusted values are not converted through `String()` or template literals.

## React difference: executable script hosts

Vidact rejects non-null raw HTML on an executable `script` element, including a
missing type, JavaScript MIME types, `module`, `importmap`, and
`speculationrules`. Non-executable JSON and data MIME types are supported.

React deliberately constructs script host nodes through an inert parser path.
Vidact currently creates host elements with `document.createElement`; adding
text to such a script before connection can execute it when the component is
mounted. Reproducing React's inert outer-script construction with strict
Trusted Types would require either an application-owned TrustedHTML policy or a
different host-construction primitive. Vidact will not create a hidden policy
or silently execute code, so the compiler rejects statically provable cases and
the runtime rejects dynamic ones.

Scripts nested inside another element's raw HTML follow the platform's
`innerHTML` behavior and remain parser-inert. This contract does not make event
handler attributes, URLs, iframes, styles, or other injected markup safe.

## Alternatives considered

- **Assign `element.innerHTML` as a generic prop:** smallest implementation,
  but it can destroy owned children and cannot preserve failed-publication node
  identity.
- **Sanitize strings inside Vidact:** creates an incomplete security policy and
  changes application content. Sanitization remains the application's policy.
- **Accept only `TrustedHTML`:** strongest default but unnecessarily diverges
  from React and browsers without an enforcing CSP.
- **Create an internal Trusted Types policy:** bypasses application policy
  ownership and can fail against a CSP policy allowlist.

## Consequences

Raw HTML remains deliberately unsafe but has a precise ownership and
transaction contract. Contextual parsing and inert-document staging cost more
than a direct setter, which is acceptable for an explicit escape hatch. Raw
descendants cannot contain Vidact-managed behavior; applications needing live
components must render JSX instead.

The current browser corpus is Chromium-only. Firefox/WebKit contextual parsing,
Trusted Types availability, and CSP-header enforcement remain release gates.
The vendored React analysis currently rejects getter syntax in object literals
before Vidact lowering, so a source-level `{ get __html() { ... } }` wrapper is
not yet compilable even though the runtime honors JavaScript getters and
inherited `__html` properties. Compute the payload before JSX as a workaround.

## Verification

- `packages/runtime/test/reactivity/direct-dom.browser.test.ts`
- `packages/runtime/test/lifecycle/failure-atomicity.browser.test.ts`
- `tests/browser/corpus/apps/raw-html/RawHtmlApp.browser.test.ts`
- `crates/vidact-compiler/tests/surgical_codegen.rs`
- `crates/vidact-compiler/tests/fixtures/compatibility/accepted/raw-html.tsx`
- `crates/vidact-compiler/tests/fixtures/compatibility/rejected/raw-html-children.tsx`
- `crates/vidact-compiler/tests/fixtures/compatibility/rejected/raw-html-executable-script.tsx`
- `packages/react-types/test/jsx-contract.tsx`

Run `cargo test --workspace`, `pnpm --filter @vidact/runtime test`,
`pnpm --filter @vidact/browser-corpus test`, and `pnpm typecheck`.
