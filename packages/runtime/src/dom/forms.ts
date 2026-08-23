interface ControlledFormState {
  value?: unknown
  checked?: boolean
}

const controlledFormStates = new WeakMap<Element, ControlledFormState>()
const controlledRestorationCleanups = new WeakMap<Element, () => void>()

export function isControlledFormProp(element: Element, name: string): boolean {
  return (
    (name === 'value' &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement)) ||
    (name === 'checked' && element instanceof HTMLInputElement)
  )
}

export function ensureControlledFormRestoration(element: Element): () => void {
  const existing = controlledRestorationCleanups.get(element)
  if (existing !== undefined) return () => {}

  const schedule = (event: Event): void => {
    if (!isReactFormChangeEvent(element, event.type)) return
    queueMicrotask(() => restoreControlledFormState(element))
  }
  element.addEventListener('input', schedule)
  element.addEventListener('change', schedule)
  const cleanup = (): void => {
    element.removeEventListener('input', schedule)
    element.removeEventListener('change', schedule)
    controlledRestorationCleanups.delete(element)
  }
  controlledRestorationCleanups.set(element, cleanup)
  return cleanup
}

export function isReactFormChangeEvent(element: Element, eventName: string): boolean {
  if (element instanceof HTMLTextAreaElement) return eventName === 'input'
  if (element instanceof HTMLSelectElement) return eventName === 'change'
  if (!(element instanceof HTMLInputElement)) return false
  return element.type === 'checkbox' || element.type === 'radio' || element.type === 'file'
    ? eventName === 'change'
    : eventName === 'input'
}

export function applyFormProp(element: Element, name: string, value: unknown): boolean {
  if (name === 'value') {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (value === undefined) {
        delete remember(element).value
        return true
      }
      const next = value === null || value === undefined ? '' : String(value)
      remember(element).value = next
      if (element.value !== next) element.value = next
      return true
    }
    if (element instanceof HTMLSelectElement) {
      if (value === undefined) {
        delete remember(element).value
        return true
      }
      const next = normalizeSelectValue(element, value)
      remember(element).value = value
      applySelectValue(element, next)
      return true
    }
  }

  if (name === 'checked' && element instanceof HTMLInputElement) {
    if (value === undefined) {
      delete remember(element).checked
      return true
    }
    const next = Boolean(value)
    remember(element).checked = next
    if (element.checked !== next) element.checked = next
    return true
  }
  if (name === 'defaultValue' && 'defaultValue' in element) {
    Reflect.set(element, 'defaultValue', value === null || value === undefined ? '' : String(value))
    return true
  }
  if (name === 'defaultChecked' && element instanceof HTMLInputElement) {
    element.defaultChecked = Boolean(value)
    return true
  }
  if (name === 'selected' && element instanceof HTMLOptionElement) {
    element.selected = Boolean(value)
    return true
  }
  if (name === 'multiple' && element instanceof HTMLSelectElement) {
    element.multiple = Boolean(value)
    return true
  }
  if (name === 'muted' && element instanceof HTMLMediaElement) {
    element.muted = Boolean(value)
    return true
  }
  return false
}

export function restoreControlledFormState(element: Element): void {
  restoreElement(element)
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.name === '') {
    return
  }

  const root = element.getRootNode()
  if (!(root instanceof Document || root instanceof ShadowRoot)) return
  const escapedName = CSS.escape(element.name)
  for (const candidate of root.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${escapedName}"]`,
  )) {
    if (candidate !== element && candidate.form === element.form) restoreElement(candidate)
  }
}

function restoreElement(element: Element): void {
  const state = controlledFormStates.get(element)
  if (state === undefined) return
  if (state.value !== undefined) {
    if (element instanceof HTMLSelectElement) {
      applySelectValue(element, normalizeSelectValue(element, state.value))
    } else if (
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
      element.value !== state.value
    ) {
      element.value = String(state.value)
    }
  }
  if (
    state.checked !== undefined &&
    element instanceof HTMLInputElement &&
    element.checked !== state.checked
  ) {
    element.checked = state.checked
  }
}

function remember(element: Element): ControlledFormState {
  const existing = controlledFormStates.get(element)
  if (existing !== undefined) return existing
  const state: ControlledFormState = {}
  controlledFormStates.set(element, state)
  return state
}

function normalizeSelectValue(element: HTMLSelectElement, value: unknown): unknown {
  if (!element.multiple) return value === null || value === undefined ? '' : String(value)
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    throw new TypeError('a controlled <select multiple> value must be an array')
  }
  return value.map(String)
}

function applySelectValue(element: HTMLSelectElement, value: unknown): void {
  if (!element.multiple) {
    const selected = String(value)
    let matched = false
    for (const option of element.options) {
      const next = option.value === selected
      option.selected = next
      matched ||= next
    }
    if (!matched) element.selectedIndex = -1
    return
  }

  const selected = new Set(value as readonly string[])
  for (const option of element.options) option.selected = selected.has(option.value)
}
