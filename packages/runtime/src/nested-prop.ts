import { binding, isCompiledBinding, type CompiledBinding } from './compiled.ts'

const DEV = typeof __VIDACT_DEV__ === 'undefined' || __VIDACT_DEV__

type ContainerFallback = (() => unknown) | null

export function nestedProp(
  input: unknown,
  path: readonly string[],
  containerFallbacks: readonly ContainerFallback[],
): unknown {
  const read = (): unknown => {
    let value = isCompiledBinding(input) ? input[1]() : input
    for (const [index, name] of path.entries()) {
      if (value === undefined) value = containerFallbacks[index]?.()
      if (value === null || value === undefined) {
        throw new TypeError(
          DEV ? `cannot destructure nested prop ${name} from a nullish value` : 'V015',
        )
      }
      value = (value as Record<string, unknown>)[name]
    }
    return value
  }

  return isCompiledBinding(input) ? binding(input[2], input[3], read, input[4], input[5]) : read()
}
