declare module 'react-dom' {
  import type { VidactNode } from '@vidact/react-types'
  import type { Key } from 'react'

  export function createPortal(
    children: VidactNode,
    container: Element | DocumentFragment,
    key?: Key | null,
  ): import('@vidact/runtime').StructuralBinding
}
