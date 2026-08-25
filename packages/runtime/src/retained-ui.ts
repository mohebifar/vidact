import { enableRetainedUi, retainedActivity } from './compiled/core.ts'
import type { CompiledBinding, CompiledRenderValue, StructuralBinding } from './compiled/types.ts'
import { enableRetainedUiStyles } from './dom/styles.ts'

export interface ActivityProps {
  readonly children?: (() => CompiledRenderValue) | readonly [() => CompiledRenderValue]
  readonly mode: 'visible' | 'hidden' | CompiledBinding<'visible' | 'hidden'>
  readonly name?: string
}

export function Activity(props: ActivityProps): StructuralBinding {
  const render = Array.isArray(props.children) ? props.children[0] : props.children
  if (typeof render !== 'function') {
    throw new TypeError('Activity children must be a compiler-generated render function')
  }
  enableRetainedUi()
  enableRetainedUiStyles()
  return retainedActivity(props.mode, render)
}
