const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'

export const INTERNAL_NAMESPACE_PROP = '__vidactNamespace'
export const INTERNAL_COMPONENT_SPREAD_PROP = Symbol(DEV ? 'Vidact.ComponentSpread' : undefined)

export type IntrinsicNamespace = 'html' | 'svg' | 'mathml'

interface NamespaceDomCapability {
  readonly childrenNamespace: (type: string, namespace: IntrinsicNamespace) => IntrinsicNamespace
  readonly createElement: (
    document: Document,
    type: string,
    namespace: IntrinsicNamespace,
  ) => Element
  readonly resolveNamespace: (
    type: string,
    explicit: IntrinsicNamespace | undefined,
    inherited: IntrinsicNamespace,
  ) => IntrinsicNamespace
}

let activeNamespace: IntrinsicNamespace = 'html'
let namespaceCapability: NamespaceDomCapability | undefined

/** @internal */
export function installNamespaceDomCapability(capability: NamespaceDomCapability): void {
  namespaceCapability = capability
}

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
  const publicProps: Record<string, unknown> = { ...props }
  if (children.length === 1) publicProps.children = children[0]
  else if (children.length > 1) publicProps.children = children
  delete publicProps[INTERNAL_NAMESPACE_PROP]
  delete publicProps.key
  if (publicProps.ref === undefined) delete publicProps.ref
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
  namespace: IntrinsicNamespace,
): Element {
  return (
    namespaceCapability?.createElement(document, type, namespace) ?? document.createElement(type)
  )
}

export function resolveIntrinsicNamespace(
  type: string,
  namespace: IntrinsicNamespace | undefined,
): IntrinsicNamespace {
  return namespaceCapability?.resolveNamespace(type, namespace, activeNamespace) ?? activeNamespace
}

export function intrinsicChildrenNamespace(
  type: string,
  namespace: IntrinsicNamespace,
): IntrinsicNamespace {
  return namespaceCapability?.childrenNamespace(type, namespace) ?? namespace
}
