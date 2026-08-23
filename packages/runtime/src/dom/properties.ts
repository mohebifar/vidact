import { validateRawHtmlRelatedProp } from '../raw-html.ts'
import { applyFormProp } from './forms.ts'
import { MATHML_NAMESPACE, SVG_NAMESPACE } from './namespace.ts'
import { applyStyleProp } from './styles.ts'

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

const svgAttributeAliases = new Map([
  ['accentHeight', 'accent-height'],
  ['alignmentBaseline', 'alignment-baseline'],
  ['arabicForm', 'arabic-form'],
  ['baselineShift', 'baseline-shift'],
  ['capHeight', 'cap-height'],
  ['clipPath', 'clip-path'],
  ['clipRule', 'clip-rule'],
  ['colorInterpolation', 'color-interpolation'],
  ['colorInterpolationFilters', 'color-interpolation-filters'],
  ['colorProfile', 'color-profile'],
  ['colorRendering', 'color-rendering'],
  ['crossOrigin', 'crossorigin'],
  ['dominantBaseline', 'dominant-baseline'],
  ['enableBackground', 'enable-background'],
  ['fillOpacity', 'fill-opacity'],
  ['fillRule', 'fill-rule'],
  ['floodColor', 'flood-color'],
  ['floodOpacity', 'flood-opacity'],
  ['fontFamily', 'font-family'],
  ['fontSize', 'font-size'],
  ['fontSizeAdjust', 'font-size-adjust'],
  ['fontStretch', 'font-stretch'],
  ['fontStyle', 'font-style'],
  ['fontVariant', 'font-variant'],
  ['fontWeight', 'font-weight'],
  ['glyphName', 'glyph-name'],
  ['glyphOrientationHorizontal', 'glyph-orientation-horizontal'],
  ['glyphOrientationVertical', 'glyph-orientation-vertical'],
  ['horizAdvX', 'horiz-adv-x'],
  ['horizOriginX', 'horiz-origin-x'],
  ['imageRendering', 'image-rendering'],
  ['letterSpacing', 'letter-spacing'],
  ['lightingColor', 'lighting-color'],
  ['markerEnd', 'marker-end'],
  ['markerMid', 'marker-mid'],
  ['markerStart', 'marker-start'],
  ['overlinePosition', 'overline-position'],
  ['overlineThickness', 'overline-thickness'],
  ['paintOrder', 'paint-order'],
  ['pointerEvents', 'pointer-events'],
  ['renderingIntent', 'rendering-intent'],
  ['shapeRendering', 'shape-rendering'],
  ['stopColor', 'stop-color'],
  ['stopOpacity', 'stop-opacity'],
  ['strikethroughPosition', 'strikethrough-position'],
  ['strikethroughThickness', 'strikethrough-thickness'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['strokeDashoffset', 'stroke-dashoffset'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeMiterlimit', 'stroke-miterlimit'],
  ['strokeOpacity', 'stroke-opacity'],
  ['strokeWidth', 'stroke-width'],
  ['textAnchor', 'text-anchor'],
  ['textDecoration', 'text-decoration'],
  ['textRendering', 'text-rendering'],
  ['tabIndex', 'tabindex'],
  ['transformOrigin', 'transform-origin'],
  ['underlinePosition', 'underline-position'],
  ['underlineThickness', 'underline-thickness'],
  ['unicodeBidi', 'unicode-bidi'],
  ['unicodeRange', 'unicode-range'],
  ['unitsPerEm', 'units-per-em'],
  ['vAlphabetic', 'v-alphabetic'],
  ['vHanging', 'v-hanging'],
  ['vIdeographic', 'v-ideographic'],
  ['vMathematical', 'v-mathematical'],
  ['vectorEffect', 'vector-effect'],
  ['vertAdvY', 'vert-adv-y'],
  ['vertOriginX', 'vert-origin-x'],
  ['vertOriginY', 'vert-origin-y'],
  ['wordSpacing', 'word-spacing'],
  ['writingMode', 'writing-mode'],
  ['xHeight', 'x-height'],
])

export function applyDomProp(element: Element, name: string, value: unknown): void {
  if (name === 'dangerouslySetInnerHTML') {
    throw new Error('dangerouslySetInnerHTML must be handled as an owned opaque subtree')
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
  if (name in element) Reflect.set(element, name, value)
  else element.setAttribute(attribute, value === true ? '' : String(value))
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
  const qualifiedName = name === 'className' ? 'class' : (svgAttributeAliases.get(name) ?? name)
  return { namespace: null, qualifiedName, localName: qualifiedName }
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
  if (element instanceof HTMLElement) validateRawHtmlRelatedProp(element, name)
}

function lowerInitial(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`
}
