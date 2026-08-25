import type { MountCompiledOptions } from './compiled/core.ts'
import type { CompiledComponentResult, CompiledRenderValue } from './compiled/types.ts'
import type { DirectComponent } from './direct-dom.ts'
import { installHydration } from './hydration.ts'
import { createReactElement, type CompiledRenderable } from './renderable.ts'
import {
  hydrateHotRoot as createHotHydrationRoot,
  hydrateRoot as createHydrationRoot,
  type CompiledRoot,
  type HotContext,
} from './root.ts'

installHydration()

export function createElement(
  type: string | symbol | DirectComponent | CompiledRenderable,
  props: Record<string, unknown> | null,
  ...children: CompiledRenderValue[]
): CompiledRenderable {
  return createReactElement(type, props, ...children)
}

export function hydrateRoot(
  host: ParentNode,
  application: () => CompiledComponentResult,
  options?: MountCompiledOptions,
): CompiledRoot {
  return createHydrationRoot(host, application, options)
}

export function hydrateHotRoot(
  hot: HotContext,
  host: ParentNode,
  application: () => CompiledComponentResult,
  options?: MountCompiledOptions,
): CompiledRoot {
  return createHotHydrationRoot(hot, host, application, options)
}
