/// <reference types="vite/client" />

declare module '*.mdx' {
  const Content: (props: { readonly components?: Record<string, unknown> }) => JSX.Element
  export default Content
}
