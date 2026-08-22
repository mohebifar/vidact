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
dispatches, including capture handlers. React-only hydration flags, function
form actions, and `dangerouslySetInnerHTML` are excluded. SVG remains rejected
until Vidact has namespace-aware compiler lowering.

The package also replaces React's element and child value types with Vidact's
owned compiled values. Use `VidactNode` for component props that accept
renderable children; `ReactNode` describes React element descriptors and is not
the Vidact render-value contract.
