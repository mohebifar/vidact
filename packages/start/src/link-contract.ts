import type { CompiledRenderValue } from '@vidact/runtime'

export interface LinkProps extends Readonly<Record<string, unknown>> {
  readonly children?: CompiledRenderValue
  readonly href: string
  readonly reloadDocument?: boolean
  readonly replace?: boolean
}

export function anchorProps(props: LinkProps): Record<string, unknown> {
  const { reloadDocument = false, replace = false, ...attributes } = props
  return {
    ...attributes,
    ...(reloadDocument ? {} : { 'data-vidact-start-link': '' }),
    ...(replace ? { 'data-vidact-start-replace': '' } : {}),
  }
}
