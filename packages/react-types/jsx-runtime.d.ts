import type { JSX as ReactJSX, Key, Ref } from 'react'

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

type NativeProperty<Property extends PropertyKey, ReactAttribute> = Property extends
  | 'action'
  | 'formAction'
  ? Extract<ReactAttribute, string | undefined>
  : ReactAttribute

type WithVidactProps<Name extends HtmlIntrinsicName> = {
  [
    Property in keyof ReactIntrinsicElements[Name] as Property extends
      | 'children'
      | 'suppressContentEditableWarning'
      | 'suppressHydrationWarning'
      ? never
      : Property
  ]: Property extends string
    ? Property extends `on${string}`
      ? NativeEventAttribute<Property, ElementFor<Name>, ReactIntrinsicElements[Name][Property]>
      : NativeProperty<Property, ReactIntrinsicElements[Name][Property]>
    : NativeProperty<Property, ReactIntrinsicElements[Name][Property]>
} & {
  children?: VidactNode
}

type ElementFor<Name extends HtmlIntrinsicName> = HTMLElementTagNameMap[Name]

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

  interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}

  interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}

  type IntrinsicElements = {
    [Name in HtmlIntrinsicName]: WithVidactProps<Name>
  } & {
    [Name in `${string}-${string}`]: CustomElementAttributes
  }

  type LibraryManagedAttributes<Component, Props> = ReactJSX.LibraryManagedAttributes<
    Component,
    Props
  >
}
