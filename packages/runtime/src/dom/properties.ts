import { validateRawHtmlRelatedProp } from '../raw-html.ts'
import { applyFormProp } from './forms.ts'
import { MATHML_NAMESPACE, SVG_NAMESPACE } from './namespace.ts'
import { applyStyleProp } from './styles.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
const UNSAFE_HTML = typeof __VIDACT_UNSAFE_HTML__ === 'undefined' || __VIDACT_UNSAFE_HTML__

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

const booleanAttributes = new Set([
  'allowFullScreen',
  'async',
  'autoFocus',
  'autoPlay',
  'controls',
  'default',
  'defer',
  'disabled',
  'disablePictureInPicture',
  'disableRemotePlayback',
  'formNoValidate',
  'hidden',
  'inert',
  'itemScope',
  'loop',
  'noModule',
  'noValidate',
  'open',
  'playsInline',
  'readOnly',
  'required',
  'reversed',
])
const booleanishStringAttributes = new Set(['contentEditable', 'draggable', 'spellCheck'])
const overloadedBooleanAttributes = new Set(['capture', 'download'])
const mathBooleanishStringAttributes = new Set([
  'accent',
  'accentunder',
  'displaystyle',
  'fence',
  'largeop',
  'movablelimits',
  'separator',
  'stretchy',
  'symmetric',
])
const svgBooleanishStringAttributes = new Set(['focusable', 'preserveAlpha'])

const kebabCaseSvgAttributes = new Set([
  'accentHeight',
  'alignmentBaseline',
  'arabicForm',
  'baselineShift',
  'capHeight',
  'clipPath',
  'clipRule',
  'colorInterpolation',
  'colorInterpolationFilters',
  'colorProfile',
  'colorRendering',
  'dominantBaseline',
  'enableBackground',
  'fillOpacity',
  'fillRule',
  'floodColor',
  'floodOpacity',
  'fontFamily',
  'fontSize',
  'fontSizeAdjust',
  'fontStretch',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'glyphName',
  'glyphOrientationHorizontal',
  'glyphOrientationVertical',
  'horizAdvX',
  'horizOriginX',
  'imageRendering',
  'letterSpacing',
  'lightingColor',
  'markerEnd',
  'markerMid',
  'markerStart',
  'overlinePosition',
  'overlineThickness',
  'paintOrder',
  'pointerEvents',
  'renderingIntent',
  'shapeRendering',
  'stopColor',
  'stopOpacity',
  'strikethroughPosition',
  'strikethroughThickness',
  'strokeDasharray',
  'strokeDashoffset',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeMiterlimit',
  'strokeOpacity',
  'strokeWidth',
  'textAnchor',
  'textDecoration',
  'textRendering',
  'transformOrigin',
  'underlinePosition',
  'underlineThickness',
  'unicodeBidi',
  'unicodeRange',
  'unitsPerEm',
  'vAlphabetic',
  'vHanging',
  'vIdeographic',
  'vMathematical',
  'vectorEffect',
  'vertAdvY',
  'vertOriginX',
  'vertOriginY',
  'wordSpacing',
  'writingMode',
  'xHeight',
])

export function applyDomProp(element: Element, name: string, value: unknown): void {
  if (name === 'dangerouslySetInnerHTML') {
    throw new Error(
      DEV ? 'dangerouslySetInnerHTML must be handled as an owned opaque subtree' : 'V401',
    )
  }
  if (name === 'style') {
    applyStyleProp(element, value)
    return
  }
  if (applyFormProp(element, name, value)) return
  if (name.startsWith('data-') || name.startsWith('aria-')) {
    applyStringAttribute(element, name, value)
    return
  }
  if (element.namespaceURI === SVG_NAMESPACE || element.namespaceURI === MATHML_NAMESPACE) {
    applyNamespacedAttribute(element, name, value)
    return
  }

  const attribute = htmlAttributeName(name)
  if (value === null || value === undefined) {
    element.removeAttribute(attribute)
    if (isCustomElement(element) && name in element) Reflect.set(element, name, null)
    validateRawHtmlProp(element, name)
    return
  }
  if (booleanishStringAttributes.has(name)) {
    element.setAttribute(attribute, String(value))
    return
  }
  if (overloadedBooleanAttributes.has(name)) {
    if (value === false) element.removeAttribute(attribute)
    else element.setAttribute(attribute, value === true ? '' : String(value))
    return
  }
  if (booleanAttributes.has(name)) {
    if (name in element) Reflect.set(element, name, Boolean(value))
    else if (value) element.setAttribute(attribute, '')
    else element.removeAttribute(attribute)
    return
  }
  if (typeof value === 'boolean') {
    element.removeAttribute(attribute)
    return
  }
  if (!(name in element && Reflect.set(element, name, value))) {
    element.setAttribute(attribute, String(value))
  }
  validateRawHtmlProp(element, name)
}

function applyStringAttribute(element: Element, name: string, value: unknown): void {
  if (value === null || value === undefined) element.removeAttribute(name)
  else element.setAttribute(name, String(value))
}

function applyNamespacedAttribute(element: Element, name: string, value: unknown): void {
  const descriptor = namespacedAttribute(name)
  if (value === null || value === undefined) {
    if (descriptor.namespace === null) element.removeAttribute(descriptor.qualifiedName)
    else element.removeAttributeNS(descriptor.namespace, descriptor.localName)
    return
  }
  if (
    (element.namespaceURI === MATHML_NAMESPACE && mathBooleanishStringAttributes.has(name)) ||
    (element.namespaceURI === SVG_NAMESPACE && svgBooleanishStringAttributes.has(name))
  ) {
    element.setAttribute(descriptor.qualifiedName, String(value))
    return
  }
  if (value === false) {
    if (descriptor.namespace === null) element.removeAttribute(descriptor.qualifiedName)
    else element.removeAttributeNS(descriptor.namespace, descriptor.localName)
    return
  }
  const serialized = value === true ? '' : String(value)
  if (descriptor.namespace === null) element.setAttribute(descriptor.qualifiedName, serialized)
  else element.setAttributeNS(descriptor.namespace, descriptor.qualifiedName, serialized)
}

function namespacedAttribute(name: string): {
  namespace: string | null
  qualifiedName: string
  localName: string
} {
  if (name.startsWith('xlink') && name.length > 5) {
    const localName = lowerInitial(name.slice(5))
    return { namespace: XLINK_NAMESPACE, qualifiedName: `xlink:${localName}`, localName }
  }
  if (name === 'xmlnsXlink') {
    return {
      namespace: 'http://www.w3.org/2000/xmlns/',
      qualifiedName: 'xmlns:xlink',
      localName: 'xlink',
    }
  }
  if (name.startsWith('xml') && name.length > 3) {
    const localName = lowerInitial(name.slice(3))
    return { namespace: XML_NAMESPACE, qualifiedName: `xml:${localName}`, localName }
  }
  const qualifiedName = svgAttributeName(name)
  return { namespace: null, qualifiedName, localName: qualifiedName }
}

function svgAttributeName(name: string): string {
  if (name === 'className') return 'class'
  if (name === 'crossOrigin') return 'crossorigin'
  if (name === 'tabIndex') return 'tabindex'
  if (!kebabCaseSvgAttributes.has(name)) return name
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

function htmlAttributeName(name: string): string {
  if (name === 'className') return 'class'
  if (name === 'htmlFor') return 'for'
  if (name === 'acceptCharset') return 'accept-charset'
  if (name === 'httpEquiv') return 'http-equiv'
  return name
}

function isCustomElement(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && element.localName.includes('-')
}

function validateRawHtmlProp(element: Element, name: string): void {
  if (UNSAFE_HTML && element instanceof HTMLElement) validateRawHtmlRelatedProp(element, name)
}

function lowerInitial(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`
}
