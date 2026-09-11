import { compiledRoot, createNarrowCompiledScope, type CompiledRenderValue } from '@vidact/runtime'
import { createElement } from '@vidact/runtime/hydrate'

import { anchorProps, type LinkProps } from './link-contract.ts'

export function Link(props: LinkProps): CompiledRenderValue {
  const scope = createNarrowCompiledScope()
  return compiledRoot(scope, () => createElement('a', anchorProps(props)))
}

export type { LinkProps }
