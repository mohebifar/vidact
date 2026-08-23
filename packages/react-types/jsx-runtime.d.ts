import type {
  CSSProperties,
  Context,
  HTMLAttributes,
  JSX as ReactJSX,
  Key,
  Provider,
  Ref,
} from 'react'

export type VidactNode = import('@vidact/runtime').CompiledRenderValue

type ReactIntrinsicElements = ReactJSX.IntrinsicElements

type EventName<Property extends string> = Property extends `on${infer Name}Capture`
  ? Name
  : Property extends `on${infer Name}`
    ? Name
    : never

type NativeEventName<Name extends string> = Name extends 'DoubleClick'
  ? 'dblclick'
  : Lowercase<Name>

type NativeEvent<Property extends string> =
  NativeEventName<EventName<Property>> extends keyof GlobalEventHandlersEventMap
    ? GlobalEventHandlersEventMap[NativeEventName<EventName<Property>>]
    : Event

type NativeEventHandler<Property extends string, Target extends EventTarget> = (
  event: NativeEvent<Property> & { readonly currentTarget: Target },
) => void

type NativeEventAttribute<Property extends string, Target extends EventTarget, ReactAttribute> =
  | NativeEventHandler<Property, Target>
  | Extract<ReactAttribute, null | undefined>

type HtmlIntrinsicName = Extract<keyof ReactIntrinsicElements, keyof HTMLElementTagNameMap>
type SvgIntrinsicName = Exclude<
  Extract<keyof ReactIntrinsicElements, keyof SVGElementTagNameMap>,
  HtmlIntrinsicName
>
type MathIntrinsicName = keyof MathMLElementTagNameMap

type VidactStyle = CSSProperties & {
  [Name in `--${string}`]?: string | number | null | undefined
}

type NativeProperty<Property extends PropertyKey, ReactAttribute> = Property extends
  | 'action'
  | 'formAction'
  ? Extract<ReactAttribute, string | undefined>
  : Property extends 'style'
    ? VidactStyle | Extract<ReactAttribute, null | undefined>
    : ReactAttribute

type WithVidactProps<
  Name extends keyof ReactIntrinsicElements,
  Target extends EventTarget,
> = WithVidactAttributes<ReactIntrinsicElements[Name], Target>

type WithVidactAttributes<Attributes, Target extends EventTarget> = {
  [
    Property in keyof Attributes as Property extends
      | 'children'
      | 'suppressContentEditableWarning'
      | 'suppressHydrationWarning'
      ? never
      : Property extends 'dangerouslySetInnerHTML'
        ? Target extends HTMLElement
          ? Property
          : never
        : Property
  ]: Property extends string
    ? Property extends `on${string}`
      ? NativeEventAttribute<Property, Target, Attributes[Property]>
      : NativeProperty<Property, Attributes[Property]>
    : NativeProperty<Property, Attributes[Property]>
} & {
  children?: VidactNode
}

interface MathMLAttributes extends HTMLAttributes<MathMLElement> {
  accent?: boolean | 'true' | 'false'
  accentunder?: boolean | 'true' | 'false'
  columnalign?: string
  columnlines?: string
  columnspacing?: string
  display?: 'block' | 'inline'
  displaystyle?: boolean | 'true' | 'false'
  fence?: boolean | 'true' | 'false'
  frame?: string
  linethickness?: string | number
  mathbackground?: string
  mathcolor?: string
  mathsize?: string | number
  mathvariant?: string
  maxsize?: string | number
  minsize?: string | number
  movablelimits?: boolean | 'true' | 'false'
  notation?: string
  rowalign?: string
  rowlines?: string
  rowspacing?: string
  scriptlevel?: string | number
  separator?: boolean | 'true' | 'false'
  stretchy?: boolean | 'true' | 'false'
  symmetric?: boolean | 'true' | 'false'
}

interface CustomElementAttributes extends Record<string, unknown> {
  children?: VidactNode
  key?: Key | null
  ref?: Ref<Element>
}

export { Fragment, jsx, jsxs } from '@vidact/runtime/jsx-runtime'

export namespace JSX {
  type Element = import('@vidact/runtime').CompiledComponentResult

  type ElementType =
    | keyof IntrinsicElements
    // Component props are checked from the component's own signature.
    | ((props: never) => VidactNode)
    | Context<never>
    | Provider<never>

  interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}

  interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}

  type IntrinsicElements = {
    [Name in HtmlIntrinsicName]: WithVidactProps<Name, HTMLElementTagNameMap[Name]>
  } & {
    [Name in SvgIntrinsicName]: WithVidactProps<Name, SVGElementTagNameMap[Name]>
  } & {
    [Name in MathIntrinsicName]: WithVidactAttributes<
      MathMLAttributes,
      MathMLElementTagNameMap[Name]
    >
  } & {
    [Name in `${string}-${string}`]: CustomElementAttributes
  }

  type LibraryManagedAttributes<Component, Props> = Component extends
    | Context<infer Value>
    | Provider<infer Value>
    ? { children?: VidactNode; value: Value }
    : ReactJSX.LibraryManagedAttributes<Component, Props>
}
