import type { CompiledRenderValue } from '@vidact/runtime'

export interface LinkProps extends Readonly<Record<string, unknown>> {
  readonly children?: CompiledRenderValue
  readonly href: string
  /** `intent` (the default) prefetches on hover, focus, or press; `none` waits for the click. */
  readonly prefetch?: 'intent' | 'none'
  readonly reloadDocument?: boolean
  readonly replace?: boolean
}

export function anchorProps(props: LinkProps): Record<string, unknown> {
  const { prefetch = 'intent', reloadDocument = false, replace = false, ...attributes } = props
  return {
    ...attributes,
    ...(reloadDocument ? {} : { 'data-vidact-start-link': '' }),
    ...(replace ? { 'data-vidact-start-replace': '' } : {}),
    ...(!reloadDocument && prefetch === 'none' ? { 'data-vidact-start-prefetch': 'none' } : {}),
  }
}
