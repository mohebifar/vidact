/**
 * Virtual `react` / `react-dom` facades.
 *
 * Vidact never ships React itself: every React entry point is resolved to a virtual module whose
 * source re-exports the matching Vidact runtime. Which runtime that is depends on the compiler
 * target, and which named exports exist depends on the enabled features, so each facade is
 * generated from the declarative tables below.
 */

import type { VidactCompilerConfiguration, VidactFeature, VidactTarget } from './compiler-client.ts'

const REACT_MODULE = '\0vidact:react'
const REACT_JSX_RUNTIME_MODULE = '\0vidact:react-jsx-runtime'
const REACT_JSX_DEV_RUNTIME_MODULE = '\0vidact:react-jsx-dev-runtime'
const REACT_DOM_MODULE = '\0vidact:react-dom'
const REACT_DOM_SERVER_MODULE = '\0vidact:react-dom-server'
const REACT_DOM_STATIC_MODULE = '\0vidact:react-dom-static'

const REACT_MODULE_BY_SPECIFIER = new Map<string, string>([
  ['react', REACT_MODULE],
  ['react/jsx-runtime', REACT_JSX_RUNTIME_MODULE],
  ['react/jsx-dev-runtime', REACT_JSX_DEV_RUNTIME_MODULE],
  ['react-dom', REACT_DOM_MODULE],
  ['react-dom/server', REACT_DOM_SERVER_MODULE],
  ['react-dom/server.edge', REACT_DOM_SERVER_MODULE],
  ['react-dom/static', REACT_DOM_STATIC_MODULE],
])

const RUNTIME = '@vidact/runtime'
const SERVER_RUNTIME = '@vidact/runtime/server'
const HYDRATE_RUNTIME = '@vidact/runtime/hydrate'

/** React version reported to libraries that feature-detect on `React.version`. */
const REACT_VERSION = '19.2.0'

const CLIENT_ELEMENT_EXPORTS = [
  'cloneRenderable as cloneElement',
  'createContext',
  'createReactElement as createElement',
  'createRef',
  'isRenderable as isValidElement',
]
const CLIENT_HOOK_EXPORTS = [
  'useCallback',
  'useContext',
  'useEffect',
  'useEffectEvent',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useRef',
  'useSyncExternalStore',
]
const SERVER_CORE_EXPORTS = [
  'cloneRenderable as cloneElement',
  'createContext',
  'createElement',
  'createRef',
  'isRenderable as isValidElement',
  'use',
  'useCallback',
  'useContext',
  'useEffect',
  'useEffectEvent',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
]
const ASYNC_EXPORTS = ['Suspense', 'lazy', 'use']
const CONCURRENT_EXPORTS = ['startTransition', 'useDeferredValue', 'useTransition']
const ACTION_EXPORTS = ['useActionState', 'useOptimistic']
const FRAMEWORK_CACHE_EXPORTS = ['cache', 'cacheSignal']
const PROFILING_EXPORTS = ['Profiler', 'captureOwnerStack', 'useDebugValue']
const RESOURCE_HINT_EXPORTS = [
  'preconnect',
  'prefetchDNS',
  'preinit',
  'preinitModule',
  'preload',
  'preloadModule',
]
const STREAMING_EXPORTS = [
  'renderToPipeableStream',
  'renderToReadableStream',
  'resume',
  'resumeToPipeableStream',
]

/** Resolves a React entry point to its virtual module id, or `null` when it is not one. */
export function resolveReactModuleId(specifier: string): string | null {
  return REACT_MODULE_BY_SPECIFIER.get(specifier) ?? null
}

/** Generates the facade source for a virtual React module id, or `null` when it is not one. */
export function loadReactModule(
  id: string,
  configuration: VidactCompilerConfiguration,
): string | null {
  switch (id) {
    case REACT_MODULE:
      return reactFacade(configuration)
    case REACT_JSX_RUNTIME_MODULE:
      return jsxRuntimeFacade(configuration.target, 'jsx-runtime')
    case REACT_JSX_DEV_RUNTIME_MODULE:
      return jsxRuntimeFacade(configuration.target, 'jsx-dev-runtime')
    case REACT_DOM_MODULE:
      return reactDomFacade(configuration)
    case REACT_DOM_SERVER_MODULE:
      return reactDomServerFacade(configuration)
    case REACT_DOM_STATIC_MODULE:
      return reactDomStaticFacade(configuration)
    default:
      return null
  }
}

function reactFacade(configuration: VidactCompilerConfiguration): string {
  const enabled = featurePredicate(configuration.features)
  return configuration.target === 'server'
    ? // The server runtime is a single module: every feature family re-exports from it.
      lines(
        reexport(
          [
            ...(enabled('async') ? ['Suspense', 'lazy'] : []),
            ...(enabled('concurrent') ? CONCURRENT_EXPORTS : []),
            ...(enabled('actions') ? ACTION_EXPORTS : []),
            ...(enabled('framework') ? FRAMEWORK_CACHE_EXPORTS : []),
            ...SERVER_CORE_EXPORTS,
          ],
          SERVER_RUNTIME,
        ),
        versionExport(),
        enabled('retained-ui') && reexport(['Activity'], SERVER_RUNTIME),
        enabled('profiling') && reexport(PROFILING_EXPORTS, SERVER_RUNTIME),
      )
    : // Client feature families live in isolated entry points so unused ones stay unbundled.
      lines(
        configuration.target === 'hydrate' && `import "${HYDRATE_RUNTIME}"`,
        reexport(
          [
            ...CLIENT_ELEMENT_EXPORTS,
            // With `async` enabled, `use` ships from the async entry point instead.
            ...(enabled('async') ? [] : ['use']),
            ...CLIENT_HOOK_EXPORTS,
          ],
          RUNTIME,
        ),
        versionExport(),
        enabled('async') && reexport(ASYNC_EXPORTS, `${RUNTIME}/async`),
        enabled('concurrent') && reexport(CONCURRENT_EXPORTS, `${RUNTIME}/concurrent`),
        enabled('actions') && reexport(ACTION_EXPORTS, `${RUNTIME}/actions`),
        enabled('retained-ui') && reexport(['Activity'], `${RUNTIME}/retained-ui`),
        enabled('profiling') && reexport(PROFILING_EXPORTS, `${RUNTIME}/profiling`),
      )
}

function reactDomFacade(configuration: VidactCompilerConfiguration): string {
  const enabled = featurePredicate(configuration.features)
  const hints = enabled('framework')
    ? reexport(
        RESOURCE_HINT_EXPORTS,
        configuration.target === 'server' ? SERVER_RUNTIME : `${RUNTIME}/framework`,
      )
    : false
  return configuration.target === 'server'
    ? lines(
        reexport(
          [
            'createPortal',
            ...(enabled('concurrent') ? ['flushSync'] : []),
            ...(enabled('actions') ? ['useFormStatus'] : []),
          ],
          SERVER_RUNTIME,
        ),
        hints,
      )
    : lines(
        reexport(['createPortal'], RUNTIME),
        enabled('concurrent') && reexport(['flushSync'], `${RUNTIME}/concurrent`),
        enabled('actions') && reexport(['useFormStatus'], `${RUNTIME}/actions`),
        hints,
      )
}

function reactDomServerFacade(configuration: VidactCompilerConfiguration): string {
  if (configuration.target !== 'server') {
    return unsupported('react-dom/server requires the server target')
  }
  return lines(
    reexport(['renderToStaticMarkup', 'renderToString'], SERVER_RUNTIME),
    configuration.features.includes('framework') &&
      reexport(STREAMING_EXPORTS, `${RUNTIME}/framework/server`),
  )
}

function reactDomStaticFacade(configuration: VidactCompilerConfiguration): string {
  if (configuration.target !== 'server' || !configuration.features.includes('framework')) {
    return unsupported('react-dom/static requires the server target and framework feature')
  }
  return reexport(['prerender', 'prerenderToNodeStream'], `${RUNTIME}/framework/server`)
}

function jsxRuntimeFacade(target: VidactTarget, entry: string): string {
  const runtime =
    target === 'server'
      ? `${SERVER_RUNTIME}/${entry}`
      : target === 'hydrate'
        ? `${HYDRATE_RUNTIME}/${entry}`
        : `${RUNTIME}/jsx-runtime`
  return `export * from "${runtime}"`
}

function featurePredicate(features: readonly VidactFeature[]): (feature: VidactFeature) => boolean {
  const enabled = new Set(features)
  return (feature) => enabled.has(feature)
}

function reexport(names: readonly string[], moduleId: string): string {
  return `export { ${names.join(', ')} } from "${moduleId}"`
}

function versionExport(): string {
  return `export const version = "${REACT_VERSION}"`
}

function unsupported(message: string): string {
  return `throw new Error(${JSON.stringify(message)})`
}

function lines(...parts: (string | false)[]): string {
  return parts.filter((part) => part !== false).join('\n')
}
