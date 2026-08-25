// oxlint-disable-next-line typescript/triple-slash-reference -- Include the build define in consuming TypeScript programs.
/// <reference path="./env.d.ts" />

export {
  binding,
  choose,
  compiledEvent,
  compiledEffect,
  compiledImperativeHandle,
  compiledInsertionEffect,
  compiledLayoutEffect,
  compiledRoot,
  createCompiledContext,
  createCompiledEffectEvent,
  createCompiledExternalStore,
  createCompiledId,
  createCompiledMemo,
  createCompiledProp,
  createCompiledReducer,
  createCompiledRestProp,
  createCompiledScope,
  createCompiledState,
  createContext,
  createNarrowCompiledScope,
  createPortal,
  deferred,
  dispatch,
  errorBoundary,
  indexed,
  keyed,
  mountCompiled,
  mountCompiledRef,
  use,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  when,
  type ChoiceMode,
  type MountCompiledOptions,
} from './compiled/core.ts'
export type {
  CompiledBinding,
  CompiledComponentResult,
  CompiledContext,
  CompiledErrorHandler,
  CompiledRenderValue,
  CompiledScope,
  OwnedBlock,
  StructuralBinding,
} from './compiled/types.ts'
export { compiledComponentSpread } from './component-spread.ts'
export {
  createElement,
  Fragment,
  h,
  type DirectChild,
  type DirectComponent,
  type DirectProps,
} from './direct-dom.ts'
export { nestedProp } from './nested-prop.ts'
export { assertRuntimeProtocol, VIDACT_RUNTIME_PROTOCOL } from './protocol.ts'
export { useRef, type MutableRef } from './ref.ts'
export {
  cloneRenderable,
  cloneRenderableComponent,
  createReactElement,
  createRenderable,
  dynamicIntrinsicComponent,
  forwardedRef,
  isRenderable,
  renderableChildren,
  renderableMarker,
  renderableProps,
  renderableRef,
  renderableToArray,
  type CompiledRenderable,
  type RenderablePropsInput,
} from './renderable.ts'
export { createRoot, mountHotRoot, type CompiledRoot, type HotContext } from './root.ts'
export { combineSources, intersectsSources, source, type SourceMask } from './source-mask.ts'
export { compiledSpread } from './spread.ts'
export type { StateUpdate } from './state-slot.ts'
