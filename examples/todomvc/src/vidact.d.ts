declare namespace JSX {
  type Element = import('@vidact/runtime').CompiledComponentResult

  interface IntrinsicAttributes {
    key?: string | number
  }

  interface IntrinsicElements {
    [name: string]: Record<string, unknown>
  }
}

declare module 'react' {
  export const useRef: typeof import('@vidact/runtime').useRef
  export function useState<T>(
    initialValue: T | (() => T),
  ): [T, (update: import('@vidact/runtime').StateUpdate<T>) => void]
}

declare module '*.css' {}
