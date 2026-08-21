declare namespace JSX {
  type Element = Node

  interface IntrinsicElements {
    [name: string]: Record<string, unknown>
  }
}

declare module 'react' {
  export const useState: typeof import('@vidact/runtime').useState
}

declare module '*.css' {}
