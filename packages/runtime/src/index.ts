// oxlint-disable-next-line typescript/triple-slash-reference -- Include the build define in consuming TypeScript programs.
/// <reference path="./env.d.ts" />
export { combineSources, intersectsSources, source, type SourceMask } from './source-mask.ts'
export type { StateUpdate } from './state-slot.ts'
export {
  Fragment,
  h,
  type DirectChild,
  type DirectComponent,
  type DirectProps,
} from './direct-dom.ts'
export { useRef, type MutableRef } from './ref.ts'
export { assertRuntimeProtocol, VIDACT_RUNTIME_PROTOCOL } from './protocol.ts'
export { compiledSpread } from './spread.ts'
export { compiledComponentSpread } from './component-spread.ts'
export { nestedProp } from './nested-prop.ts'
export {
  binding,
  choose,
  compiledEvent,
  compiledEffect,
  compiledImperativeHandle,
  compiledLayoutEffect,
  compiledRoot,
  createCompiledContext,
  createCompiledEffectEvent,
  createCompiledExternalStore,
  createCompiledMemo,
  createCompiledProp,
  createCompiledReducer,
  createCompiledRestProp,
  createCompiledScope,
  createNarrowCompiledScope,
  createCompiledState,
  createContext,
  dispatch,
  deferred,
  indexed,
  keyed,
  mountCompiled,
  mountCompiledRef,
  useCallback,
  use,
  useContext,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  when,
  type CompiledBinding,
  type CompiledComponentResult,
  type CompiledContext,
  type CompiledRenderValue,
  type CompiledScope,
  type ChoiceMode,
  type OwnedBlock,
  type StructuralBinding,
} from './compiled.ts'
