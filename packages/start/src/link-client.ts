import type { CompiledRenderValue } from '@vidact/runtime'
import { createElement } from '@vidact/runtime/hydrate'

import { anchorProps, type LinkProps } from './link-contract.ts'

export function Link(props: LinkProps): CompiledRenderValue {
  return createElement('a', anchorProps(props)) as unknown as CompiledRenderValue
}

export type { LinkProps }
