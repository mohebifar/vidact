declare module 'react-dom' {
  import type { VidactNode } from '@vidact/react-types'
  import type { Key } from 'react'

  export function createPortal(
    children: VidactNode,
    container: Element | DocumentFragment,
    key?: Key | null,
  ): import('@vidact/runtime').StructuralBinding

  export interface FormStatus {
    readonly pending: boolean
    readonly data: FormData | null
    readonly method: 'get' | 'post'
    readonly action: ((data: FormData) => unknown | PromiseLike<unknown>) | null
  }

  export function useFormStatus(): FormStatus

  export function preconnect(
    href: string,
    options?: import('@vidact/runtime/framework').ResourceHintOptions,
  ): void
  export function prefetchDNS(href: string): void
  export function preload(
    href: string,
    options: import('@vidact/runtime/framework').PreloadOptions,
  ): void
  export function preloadModule(
    href: string,
    options?: import('@vidact/runtime/framework').ResourceHintOptions,
  ): void
  export function preinit(
    href: string,
    options: import('@vidact/runtime/framework').PreinitOptions,
  ): void
  export function preinitModule(
    href: string,
    options?: import('@vidact/runtime/framework').ResourceHintOptions,
  ): void
}
