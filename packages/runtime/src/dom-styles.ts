import { installStyleDomCapability } from './dom/properties.ts'
import { applyStyleProp } from './dom/styles.ts'

let enabled = false

/** @internal Compiler-injected activation for object-valued style props. */
export function enableDomStyles(): void {
  if (enabled) return
  enabled = true
  installStyleDomCapability(applyStyleProp)
}
