import type { IntrinsicNamespace } from './intrinsic.ts'

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/'

export function intrinsicNamespaceUrl(namespace: IntrinsicNamespace): string {
  if (namespace === 'svg') return SVG_NAMESPACE
  if (namespace === 'mathml') return MATHML_NAMESPACE
  return HTML_NAMESPACE
}
