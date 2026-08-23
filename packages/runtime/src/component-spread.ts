import {
  COMPONENT_SPREAD_SOURCE,
  binding,
  mountCompiledProp,
  type CompiledBinding,
} from './compiled.ts'
import { INTERNAL_COMPONENT_SPREAD_PROP } from './dom/intrinsic.ts'

type Props = Record<string, unknown>
type ComponentSpreadDirective = (props: Props) => Props
const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

function readSpreadValue(value: unknown): Props {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object') {
    throw new TypeError(
      DEV ? 'reactive component spread value must be an object or nullish' : 'V106',
    )
  }
  if (Object.hasOwn(value, 'key') || Object.hasOwn(value, 'children')) {
    throw new TypeError(DEV ? 'reactive component spreads cannot supply key or children' : 'V106')
  }
  return value as Props
}

export function compiledComponentSpread(
  input: CompiledBinding<Props>,
  overriddenNames: readonly string[],
): Record<PropertyKey, ComponentSpreadDirective> {
  const overridden = new Set(overriddenNames)
  const bindings = new Map<string, CompiledBinding<unknown>>()
  const read = (): Props => readSpreadValue(input[1]())
  const propBinding = (name: string): CompiledBinding<unknown> => {
    let value = bindings.get(name)
    if (value === undefined) {
      value = binding(input[2], input[3], () => read()[name], input[4], input[5])
      bindings.set(name, value)
    }
    return value
  }

  return {
    [INTERNAL_COMPONENT_SPREAD_PROP]: (explicitProps) => {
      mountCompiledProp(input, (value) => {
        readSpreadValue(value)
      })
      return new Proxy(explicitProps, {
        get(target, property, receiver) {
          if (property === COMPONENT_SPREAD_SOURCE) return input
          if (
            typeof property !== 'string' ||
            overridden.has(property) ||
            Object.hasOwn(target, property)
          ) {
            return Reflect.get(target, property, receiver)
          }
          return propBinding(property)
        },
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
          if (
            descriptor !== undefined ||
            typeof property !== 'string' ||
            overridden.has(property) ||
            !Object.hasOwn(read(), property)
          ) {
            return descriptor
          }
          return { configurable: true, enumerable: true }
        },
        has(target, property) {
          return (
            Reflect.has(target, property) ||
            (typeof property === 'string' &&
              !overridden.has(property) &&
              Object.hasOwn(read(), property))
          )
        },
        ownKeys(target) {
          return [
            ...new Set([
              ...Reflect.ownKeys(target),
              ...Object.keys(read()).filter((name) => !overridden.has(name)),
            ]),
          ]
        },
      })
    },
  }
}
