// oxlint-disable-next-line typescript/triple-slash-reference -- Include compiler feature defines.
/// <reference path="./env.d.ts" />

export * from './index.ts'
export {
  Suspense,
  createCompiledAsync,
  createResource,
  lazy,
  suspense,
  useAsync as use,
  type AsyncResource,
  type LazyModule,
  type ResourceOptions,
} from './compiled.ts'
