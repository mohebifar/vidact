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
export {
  binding,
  choose,
  compiledEvent,
  compiledRoot,
  createCompiledProp,
  createCompiledReducer,
  createCompiledScope,
  createNarrowCompiledScope,
  createCompiledState,
  dispatch,
  indexed,
  keyed,
  mountCompiled,
  mountCompiledRef,
  when,
  type CompiledBinding,
  type CompiledComponentResult,
  type CompiledRenderValue,
  type CompiledScope,
  type ChoiceMode,
  type OwnedBlock,
  type StructuralBinding,
} from './compiled.ts'
