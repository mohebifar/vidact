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

/**
 * Exact type identity. `Component extends typeof Suspense` is not usable as a test for "this is
 * Suspense": `SuspenseProps` is entirely optional, so every exotic component with optional props
 * (any `forwardRef` component from a typed library) satisfies it structurally and would be typed
 * as a Suspense boundary. The context branch below has the same hazard, and guards on its
 * required `value` prop instead, matching the Activity and Profiler branches.
 */
type IsExactly<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false

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
  event: NativeEvent<Property> & {
    readonly currentTarget: Target
    readonly target: EventTarget & Target
  },
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

type FunctionFormAction = (data: FormData) => void | Promise<void>

type NativeProperty<Property extends PropertyKey, ReactAttribute> = Property extends
  | 'action'
  | 'formAction'
  ? Extract<ReactAttribute, string | undefined> | FunctionFormAction
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

type CustomElementAttributes = Record<string, unknown> & {
  [Property in `on${string}`]?: NativeEventAttribute<Property, Element, null | undefined>
} & {
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
    // `memo` and `forwardRef` results, and the equivalents published by typed component
    // libraries. Their call signatures return React's `ReactNode`, so they do not match the
    // plain function form above.
    | import('react').ExoticComponent<never>
    | typeof import('react').Activity
    | typeof import('react').Profiler
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

  type LibraryManagedAttributes<Component, Props> = Props extends import('react').ActivityProps
    ? Component extends typeof import('react').Activity
      ? { children?: VidactNode; mode: 'visible' | 'hidden'; name?: string }
      : ReactJSX.LibraryManagedAttributes<Component, Props>
    : Props extends import('react').ProfilerProps
      ? Component extends typeof import('react').Profiler
        ? Omit<Props, 'children'> & { children?: VidactNode }
        : ReactJSX.LibraryManagedAttributes<Component, Props>
      : IsExactly<Component, typeof import('react').Suspense> extends true
        ? { children?: VidactNode; fallback: VidactNode }
        : Props extends { value: infer Value }
          ? [Exclude<keyof Props, 'value' | 'children'>] extends [never]
            ? Component extends Context<Value> | Provider<Value>
              ? { children?: VidactNode; value: Value }
              : ReactJSX.LibraryManagedAttributes<Component, Props>
            : ReactJSX.LibraryManagedAttributes<Component, Props>
          : ReactJSX.LibraryManagedAttributes<Component, Props>
}
