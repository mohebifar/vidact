const unitlessProperties = new Set([
  'animationIterationCount',
  'aspectRatio',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'boxFlexGroup',
  'boxOrdinalGroup',
  'columnCount',
  'columns',
  'flex',
  'flexGrow',
  'flexNegative',
  'flexOrder',
  'flexPositive',
  'flexShrink',
  'floodOpacity',
  'fontWeight',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnSpan',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowSpan',
  'gridRowStart',
  'lineClamp',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'scale',
  'stopOpacity',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
])

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

const appliedStyleNames = new WeakMap<Element, Set<string>>()

export function applyStyleProp(element: Element, value: unknown): void {
  const style = Reflect.get(element, 'style')
  if (!(style instanceof CSSStyleDeclaration)) {
    throw new TypeError(
      DEV ? 'style is only supported on elements with CSS style declarations' : 'V501',
    )
  }
  if (value !== null && value !== undefined && typeof value !== 'object') {
    throw new TypeError(DEV ? 'style prop expects an object, null, or undefined' : 'V502')
  }

  const previous = appliedStyleNames.get(element) ?? new Set<string>()
  const nextEntries =
    value === null || value === undefined ? [] : Object.entries(value as Record<string, unknown>)
  const nextNames = new Set<string>()
  for (const [name] of nextEntries) nextNames.add(name)

  for (const name of previous) {
    if (!nextNames.has(name)) setStyleValue(style, name, '')
  }
  for (const [name, next] of nextEntries) {
    setStyleValue(style, name, serializeStyleValue(name, next))
  }

  if (nextNames.size === 0) {
    appliedStyleNames.delete(element)
    if (element.getAttribute('style') === '') element.removeAttribute('style')
  } else {
    appliedStyleNames.set(element, nextNames)
  }
}

function serializeStyleValue(name: string, value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean' || value === '') return ''
  if (name.startsWith('--')) return String(value).trim()
  if (typeof value === 'number' && value !== 0 && !unitlessProperties.has(name)) {
    return `${value}px`
  }
  return String(value).trim()
}

function setStyleValue(style: CSSStyleDeclaration, name: string, value: string): void {
  if (name.startsWith('--') || name.includes('-')) {
    style.setProperty(name, value)
    return
  }
  Reflect.set(style, name === 'float' ? 'cssFloat' : name, value)
}
