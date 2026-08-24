# `@vidact/react-types`

Shared React-shaped JSX types for Vidact-compiled TSX.

Install this package together with its `@types/react` peer dependency.

Add the package to `compilerOptions.types` and select it as the JSX import
source while preserving TSX for the Vidact compiler:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@vidact/react-types",
    "types": ["@vidact/react-types"]
  }
}
```

The package reuses `@types/react` for standard HTML, ARIA, `key`, and `ref`
attributes. It adapts event handlers to the native DOM events Vidact actually
dispatches, including capture handlers. During a handler, `event.target` is
non-null and typed as the intrinsic element for every event, so an input
callback can read `event.target.value` directly and a button callback can read
`event.target.disabled` without a cast. Custom-element handlers infer `Element`
until a custom-element type registry is available.
Function-valued `action` and `formAction` props use the React 19 `FormData`
contract, and `useFormStatus` is available from `react-dom`; compilation still
requires the `actions` feature. React-only hydration flags remain excluded.
`dangerouslySetInnerHTML` uses React's `{ __html: string | TrustedHTML }`
contract and remains an explicit, unsanitized HTML sink. HTML, SVG, and MathML
intrinsic types follow Vidact's namespace-aware DOM lowering.

The package also replaces React's element and child value types with Vidact's
owned compiled values. Use `VidactNode` for component props that accept
renderable children; `ReactNode` describes React element descriptors and is not
the Vidact render-value contract.
