import { isRenderableProtocol } from '../renderable-protocol.ts'
import { isCompiledBinding, isStructuralBinding } from './core.ts'

export function hasInvalidChild(children: readonly unknown[]): boolean {
  for (const child of children) {
    if (isStructuralBinding(child) || isCompiledBinding(child) || isRenderableProtocol(child)) {
      continue
    }
    if (Array.isArray(child)) {
      if (hasInvalidChild(child)) return true
      continue
    }
    const type = typeof child
    if (
      type === 'function' ||
      type === 'symbol' ||
      (type === 'object' && child !== null && !(child instanceof Node))
    ) {
      return true
    }
  }
  return false
}
