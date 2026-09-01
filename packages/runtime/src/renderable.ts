import { binding, isCompiledBinding } from './compiled/core.ts'
import type { CompiledBinding, CompiledRenderValue, CompiledScope } from './compiled/types.ts'
import { Fragment, h, type DirectComponent } from './direct-dom.ts'
import { isRenderableProtocol, RENDERABLE } from './renderable-protocol.ts'
import type { SourceMask } from './source-mask.ts'
import { unionSources } from './source-mask.ts'
import { compiledSpread } from './spread.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__
const SPECIAL_PROPS = new Set(['children', 'key', 'ref'])

type Props = Record<string, unknown>
export type RenderablePropsInput = Props | CompiledBinding<Props>

type RenderableInternals = {
  readonly identity: unknown
  readonly input: RenderablePropsInput
  readonly reconcile: boolean
  readonly construct: (input: RenderablePropsInput) => CompiledRenderValue
}

export interface CompiledRenderable {
  readonly props: Props
  readonly [RENDERABLE]: RenderableInternals
}

export function createRenderable(
  input: RenderablePropsInput,
  construct: (input: RenderablePropsInput) => CompiledRenderValue,
  identity: unknown = construct,
  reconcile = false,
): CompiledRenderable {
  readPropsInput(input)
  const capability = {
    props: propsView(input),
  } as CompiledRenderable
  Object.defineProperty(capability, RENDERABLE, {
    configurable: false,
    enumerable: false,
    value: { identity, input, reconcile, construct } satisfies RenderableInternals,
  })
  return capability
}

export function isRenderable(value: unknown): value is CompiledRenderable {
  return isRenderableProtocol(value)
}

export function createReactElement(
  type: string | typeof Fragment | DirectComponent | CompiledRenderable,
  props: Props | null,
  ...children: CompiledRenderValue[]
): CompiledRenderable {
  const input: Props = { ...props }
  if (children.length === 1) input.children = children[0]
  else if (children.length > 1) input.children = children

  if (typeof type === 'string') return createIntrinsicRenderable(type, input)

  return createRenderable(
    input,
    (currentInput) => {
      if (isRenderable(type)) return cloneRenderable(type, currentInput)
      const resolved = readPropsInput(currentInput)
      const { children: currentChildren, key: _key, ...currentProps } = resolved
      return Object.hasOwn(resolved, 'children')
        ? h(type, currentProps, currentChildren as CompiledRenderValue)
        : h(type, currentProps)
    },
    type,
    false,
  )
}

export function renderableToArray(value: unknown): [CompiledRenderable] {
  if (!isRenderable(value)) {
    throw new TypeError(
      DEV ? 'Children.toArray requires one compiled renderable capability' : 'V107',
    )
  }
  return [value]
}

export function renderableMarker(value: unknown): undefined {
  if (!isRenderable(value)) {
    throw new TypeError(
      DEV ? 'React element metadata requires a compiled renderable capability' : 'V107',
    )
  }
  return undefined
}

export function cloneRenderable(
  value: unknown,
  overrides?: RenderablePropsInput | null,
  childrenOverride?: CompiledRenderValue | CompiledBinding<CompiledRenderValue>,
): CompiledRenderValue {
  if (!isRenderable(value)) {
    throw new TypeError(DEV ? 'cloneRenderable requires a compiled renderable capability' : 'V107')
  }
  const internals = value[RENDERABLE]
  let input = mergeInputs(internals.input, overrides)
  if (arguments.length >= 3) input = mergeInputs(input, childrenInput(childrenOverride))
  return createRenderable(
    input,
    internals.construct,
    internals.identity,
    internals.reconcile,
  ) as unknown as CompiledRenderValue
}

export function cloneRenderableComponent(props: Record<string, unknown>): CompiledRenderValue {
  const value = isCompiledBinding(props.value) ? props.value[1]() : props.value
  if (Object.hasOwn(props, 'childrenOverride')) {
    return cloneRenderable(
      value,
      props.overrides as RenderablePropsInput | null | undefined,
      props.childrenOverride as CompiledRenderValue | CompiledBinding<CompiledRenderValue>,
    )
  }
  return cloneRenderable(value, props.overrides as RenderablePropsInput | null | undefined)
}

export function keyedFragmentComponent(props: Record<string, unknown>): CompiledRenderValue {
  return props.children as CompiledRenderValue
}

export function renderableProps(input: RenderablePropsInput): Record<string, unknown> {
  const ordinary = projectInput(input, (props) =>
    Object.fromEntries(
      Reflect.ownKeys(props)
        .filter((name) => typeof name !== 'string' || !SPECIAL_PROPS.has(name))
        .map((name) => [name, Reflect.get(props, name)]),
    ),
  )
  return isCompiledBinding(ordinary) ? compiledSpread(ordinary, []) : ordinary
}

export function renderableChildren(input: RenderablePropsInput): CompiledRenderValue {
  return projectInput(input, (props) => props.children) as CompiledRenderValue
}

export function renderableRef(input: RenderablePropsInput): unknown {
  return projectInput(input, (props) => props.ref)
}

export function forwardedRef(props: Record<string, unknown>): unknown {
  return props.ref
}

export function dynamicIntrinsicComponent(props: Record<string, unknown>): CompiledRenderValue {
  const tag = isCompiledBinding(props.tag) ? props.tag[1]() : props.tag
  if (typeof tag !== 'string') {
    throw new TypeError(DEV ? 'dynamic intrinsic construction requires a string tag' : 'V107')
  }
  let input = props.props as RenderablePropsInput
  if (Object.hasOwn(props, 'childrenOverride')) {
    input = mergeInputs(
      input,
      childrenInput(
        props.childrenOverride as CompiledRenderValue | CompiledBinding<CompiledRenderValue>,
      ),
    )
  }
  return createIntrinsicRenderable(tag, input) as unknown as CompiledRenderValue
}

function createIntrinsicRenderable(tag: string, input: RenderablePropsInput): CompiledRenderable {
  return createRenderable(
    input,
    (currentInput) =>
      h(
        tag,
        { ...renderableProps(currentInput), ref: renderableRef(currentInput) },
        renderableChildren(currentInput),
      ),
    tag,
    true,
  )
}

function propsView(input: RenderablePropsInput): Props {
  return new Proxy(
    {},
    {
      get(_target, property) {
        const value = Reflect.get(readPropsInput(input), property)
        return isCompiledBinding(value) ? value[1]() : value
      },
      getOwnPropertyDescriptor(_target, property) {
        return Object.hasOwn(readPropsInput(input), property)
          ? { configurable: true, enumerable: true }
          : undefined
      },
      has(_target, property) {
        return Reflect.has(readPropsInput(input), property)
      },
      ownKeys() {
        return Reflect.ownKeys(readPropsInput(input))
      },
    },
  )
}

function childrenInput(
  value: CompiledRenderValue | CompiledBinding<CompiledRenderValue> | undefined,
): RenderablePropsInput {
  if (!isCompiledBinding(value)) return { children: value }
  return binding(value[2], value[3], () => ({ children: value[1]() }), value[4], value[5])
}

function mergeInputs(
  authored: RenderablePropsInput,
  overrides: RenderablePropsInput | null | undefined,
): RenderablePropsInput {
  if (overrides == null) return authored
  if (!isCompiledBinding(authored) && !isCompiledBinding(overrides)) {
    return { ...readPropsInput(authored), ...readPropsInput(overrides) }
  }
  const inputs = [authored, overrides]
  const subscriptions = collectSubscriptions(inputs)
  const evaluate = (): Props => ({
    ...readPropsInput(authored),
    ...readPropsInput(overrides),
  })
  return binding(
    subscriptions[0]![0],
    subscriptions[0]![1],
    evaluate,
    subscriptions[1]?.[0],
    subscriptions[1]?.[1],
  )
}

function projectInput<Value>(
  input: RenderablePropsInput,
  project: (props: Props) => Value,
): Value | CompiledBinding<Value> {
  if (!isCompiledBinding(input)) return project(readPropsInput(input))
  return binding(input[2], input[3], () => project(readPropsInput(input)), input[4], input[5])
}

function collectSubscriptions(
  inputs: readonly RenderablePropsInput[],
): Array<[CompiledScope, SourceMask]> {
  const subscriptions = new Map<CompiledScope, SourceMask>()
  for (const input of inputs) {
    if (!isCompiledBinding(input)) continue
    addSubscription(subscriptions, input[2], input[3])
    if (input[4] !== undefined && input[5] !== undefined) {
      addSubscription(subscriptions, input[4], input[5])
    }
  }
  if (subscriptions.size > 2) {
    throw new TypeError(
      DEV ? 'a compiled renderable can combine reactive props from at most two scopes' : 'V107',
    )
  }
  return [...subscriptions]
}

function addSubscription(
  subscriptions: Map<CompiledScope, SourceMask>,
  scope: CompiledScope,
  reads: SourceMask,
): void {
  const current = subscriptions.get(scope)
  subscriptions.set(scope, current === undefined ? reads : unionSources(current, reads))
}

function readPropsInput(input: RenderablePropsInput): Props {
  const value = isCompiledBinding(input) ? input[1]() : input
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(DEV ? 'compiled renderable props must evaluate to an object' : 'V107')
  }
  return value
}
