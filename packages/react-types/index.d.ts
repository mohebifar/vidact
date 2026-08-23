import type { JSX as VidactJSX } from './jsx-runtime.d.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Register the react-dom compatibility module.
import './react-dom.d.ts'

export type { VidactNode } from './jsx-runtime.d.ts'

declare module 'react' {
  export function lazy<Component extends (props: never) => import('./jsx-runtime.d.ts').VidactNode>(
    load: () => PromiseLike<{ default: Component }>,
  ): Component
}

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
