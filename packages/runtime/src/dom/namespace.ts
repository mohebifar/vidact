export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

export const INTERNAL_NAMESPACE_PROP = '__vidactNamespace'
export const INTERNAL_COMPONENT_SPREAD_PROP = Symbol(DEV ? 'Vidact.ComponentSpread' : undefined)

export type IntrinsicNamespace = 'html' | 'svg' | 'mathml'

let activeNamespace: IntrinsicNamespace = 'html'

export function currentIntrinsicNamespace(): IntrinsicNamespace {
  return activeNamespace
}

export function readIntrinsicNamespace(
  props: Record<string, unknown> | null,
): IntrinsicNamespace | undefined {
  const value = props?.[INTERNAL_NAMESPACE_PROP]
  return value === 'html' || value === 'svg' || value === 'mathml' ? value : undefined
}

export function createComponentProps(
  props: Record<string, unknown> | null,
  children: readonly unknown[],
): Record<string, unknown> {
  const publicProps: Record<string, unknown> = { ...props, children }
  delete publicProps[INTERNAL_NAMESPACE_PROP]
  const propsWithDirective = publicProps as Record<PropertyKey, unknown>
  const directive = propsWithDirective[INTERNAL_COMPONENT_SPREAD_PROP]
  delete propsWithDirective[INTERNAL_COMPONENT_SPREAD_PROP]
  return typeof directive === 'function'
    ? (directive(publicProps) as Record<string, unknown>)
    : publicProps
}

export function withIntrinsicNamespace<Result>(
  namespace: IntrinsicNamespace | undefined,
  render: () => Result,
): Result {
  const previous = activeNamespace
  activeNamespace = namespace ?? previous
  try {
    return render()
  } finally {
    activeNamespace = previous
  }
}

export function createIntrinsicElement(
  document: Document,
  type: string,
  namespace: IntrinsicNamespace | undefined,
): Element {
  const resolved = resolveIntrinsicNamespace(type, namespace)
  if (resolved === 'svg') return document.createElementNS(SVG_NAMESPACE, type)
  if (resolved === 'mathml') return document.createElementNS(MATHML_NAMESPACE, type)
  return document.createElement(type)
}

export function resolveIntrinsicNamespace(
  type: string,
  namespace: IntrinsicNamespace | undefined,
): IntrinsicNamespace {
  return namespace ?? rootNamespace(type, activeNamespace)
}

export function intrinsicChildrenNamespace(
  type: string,
  namespace: IntrinsicNamespace,
): IntrinsicNamespace {
  return namespace === 'svg' && type === 'foreignObject' ? 'html' : namespace
}

function rootNamespace(type: string, inherited: IntrinsicNamespace): IntrinsicNamespace {
  if (inherited !== 'html') return inherited
  if (type === 'svg') return 'svg'
  if (type === 'math') return 'mathml'
  return inherited
}
