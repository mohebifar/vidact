export const SERVER_BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'allowFullScreen',
  'async',
  'autoFocus',
  'autoPlay',
  'checked',
  'controls',
  'default',
  'defaultChecked',
  'defer',
  'disabled',
  'disablePictureInPicture',
  'disableRemotePlayback',
  'formNoValidate',
  'hidden',
  'inert',
  'itemScope',
  'loop',
  'multiple',
  'muted',
  'noModule',
  'noValidate',
  'open',
  'playsInline',
  'readOnly',
  'required',
  'reversed',
  'selected',
])

const SERVER_ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  acceptCharset: 'accept-charset',
  className: 'class',
  crossOrigin: 'crossorigin',
  defaultChecked: 'checked',
  defaultValue: 'value',
  formAction: 'formaction',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
  itemID: 'itemid',
  itemProp: 'itemprop',
  itemRef: 'itemref',
  itemScope: 'itemscope',
  itemType: 'itemtype',
}

export const VALID_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/

export const META_IDENTITY_PROPS = ['charSet', 'name', 'property', 'httpEquiv'] as const
export const LINK_IDENTITY_PROPS = ['rel', 'href', 'as'] as const
export const META_IDENTITY_ATTRIBUTES = ['charset', 'name', 'property', 'http-equiv'] as const

export function serverHtmlAttributeName(name: string): string {
  return SERVER_ATTRIBUTE_ALIASES[name] ?? name
}
