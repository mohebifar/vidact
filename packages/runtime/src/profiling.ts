import {
  captureCompiledOwnerStack,
  enableProfiling,
  profiled,
  recordCompiledDebugValue,
  type CompiledBinding,
  type CompiledRenderValue,
  type ProfilerOnRender,
  type StructuralBinding,
} from './compiled.ts'

export * from './index.ts'

export interface ProfilerProps {
  readonly children?: (() => CompiledRenderValue) | readonly [() => CompiledRenderValue]
  readonly id: string | CompiledBinding<string>
  readonly onRender: ProfilerOnRender | CompiledBinding<ProfilerOnRender>
}

export function Profiler(props: ProfilerProps): StructuralBinding {
  const render = Array.isArray(props.children) ? props.children[0] : props.children
  if (typeof render !== 'function') {
    throw new TypeError('Profiler children must be a compiler-generated render function')
  }
  enableProfiling()
  return profiled(props.id, props.onRender, render)
}

export function useDebugValue<Value>(
  value: Value | CompiledBinding<Value>,
  format?: (value: Value) => unknown,
): void {
  if (format !== undefined && typeof format !== 'function') {
    throw new TypeError('useDebugValue formatter must be a function')
  }
  enableProfiling()
  recordCompiledDebugValue(value, format)
}

export function captureOwnerStack(): string | null {
  enableProfiling()
  return captureCompiledOwnerStack()
}
