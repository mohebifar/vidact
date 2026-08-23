import {
  applyFormProp,
  ensureControlledFormRestoration,
  isControlledFormProp,
  isReactFormChangeEvent,
  restoreControlledFormState,
} from './dom/forms.ts'
import { installFormDomCapability } from './dom/properties.ts'

let enabled = false

/** @internal Compiler-injected activation for form-specific DOM behavior. */
export function enableDomForms(): void {
  if (enabled) return
  enabled = true
  installFormDomCapability({
    applyProp: applyFormProp,
    ensureControlledRestoration: ensureControlledFormRestoration,
    isControlledProp: isControlledFormProp,
    isReactChangeEvent: isReactFormChangeEvent,
    restoreControlledState: restoreControlledFormState,
  })
}
