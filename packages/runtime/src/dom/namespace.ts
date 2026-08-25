import { installNamespaceDomCapability, type IntrinsicNamespace } from './intrinsic.ts'
import { MATHML_NAMESPACE, SVG_NAMESPACE } from './namespaces.ts'

let enabled = false

/** @internal Compiler-injected activation for SVG and MathML namespace behavior. */
export function enableDomNamespace(): void {
  if (enabled) return
  enabled = true
  installNamespaceDomCapability({
    childrenNamespace: (type, namespace) =>
      namespace === 'svg' && type === 'foreignObject' ? 'html' : namespace,
    createElement(document, type, namespace) {
      if (namespace === 'svg') return document.createElementNS(SVG_NAMESPACE, type)
      if (namespace === 'mathml') return document.createElementNS(MATHML_NAMESPACE, type)
      return document.createElement(type)
    },
    resolveNamespace(type, explicit, inherited) {
      if (explicit !== undefined) return explicit
      return rootNamespace(type, inherited)
    },
  })
}

function rootNamespace(type: string, inherited: IntrinsicNamespace): IntrinsicNamespace {
  if (inherited !== 'html') return inherited
  if (type === 'svg') return 'svg'
  if (type === 'math') return 'mathml'
  return inherited
}
