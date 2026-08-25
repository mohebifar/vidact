import type { CompiledRenderValue } from '@vidact/runtime'
import { createElement, type ServerChild } from '@vidact/runtime/server'

import { anchorProps, type LinkProps } from './link-contract.ts'

export function Link(props: LinkProps): CompiledRenderValue {
  return createElement('a', anchorProps(props)) as ServerChild as unknown as CompiledRenderValue
}

export type { LinkProps }
