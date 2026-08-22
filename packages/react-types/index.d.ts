import type { JSX as VidactJSX } from './jsx-runtime.d.ts'

export type { VidactNode } from './jsx-runtime.d.ts'

declare global {
  namespace JSX {
    type Element = VidactJSX.Element
    type ElementType = VidactJSX.ElementType
    interface ElementChildrenAttribute extends VidactJSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends VidactJSX.IntrinsicAttributes {}
    type IntrinsicElements = VidactJSX.IntrinsicElements
    type LibraryManagedAttributes<Component, Props> = VidactJSX.LibraryManagedAttributes<
      Component,
      Props
    >
  }
}
