import { afterEach, describe, expect, it } from 'vitest'

import {
  Suspense,
  compiledRoot,
  createCompiledAsync,
  createNarrowCompiledScope,
  createResource,
  errorBoundary,
  h,
  lazy,
  mountCompiled,
  source,
  type CompiledRenderValue,
} from '../../src/async.ts'

afterEach(() => document.body.replaceChildren())

function deferred<Value>(): {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
  readonly reject: (reason: unknown) => void
} {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function asyncText(promise: PromiseLike<string>): () => CompiledRenderValue {
  return () => {
    const scope = createNarrowCompiledScope()
    const value = createCompiledAsync(scope, source(0), promise)
    return compiledRoot(scope, () => h('strong', { 'data-content': true }, value.get()))
  }
}

function mountSuspense(
  content: () => CompiledRenderValue,
  host: HTMLElement,
  fallback = 'loading',
) {
  return mountCompiled(() => {
    const scope = createNarrowCompiledScope()
    return compiledRoot(scope, () =>
      Suspense({
        children: content,
        fallback: () => h('p', { 'data-fallback': true }, fallback),
      }),
    )
  }, host)
}

describe('async resources and Suspense', () => {
  it('publishes a fallback until staged content fulfills', async () => {
    const value = deferred<string>()
    const host = document.createElement('div')
    const mounted = mountSuspense(() => h(asyncText(value.promise), null), host)

    expect(host.querySelector('[data-fallback]')?.textContent).toBe('loading')
    expect(host.querySelector('[data-content]')).toBeNull()

    value.resolve('ready')
    await value.promise
    await Promise.resolve()

    expect(host.querySelector('[data-fallback]')).toBeNull()
    expect(host.querySelector('[data-content]')?.textContent).toBe('ready')
    mounted.dispose()
  })

  it('deduplicates lazy module loading and nested boundary retries', async () => {
    const module = deferred<{ default: () => CompiledRenderValue }>()
    let loads = 0
    const Lazy = lazy(() => {
      loads += 1
      return module.promise
    })
    const innerHost = document.createElement('div')
    const mounted = mountSuspense(
      () =>
        Suspense({
          children: () => [h(Lazy, null), h(Lazy, null)],
          fallback: () => h('i', { 'data-inner': true }, 'inner'),
        }),
      innerHost,
      'outer',
    )

    expect(innerHost.querySelector('[data-inner]')?.textContent).toBe('inner')
    expect(innerHost.querySelector('[data-fallback]')).toBeNull()
    expect(loads).toBe(1)

    module.resolve({ default: () => h('b', null, 'loaded') })
    await module.promise
    await Promise.resolve()

    expect(innerHost.querySelector('[data-inner]')).toBeNull()
    expect(innerHost.querySelectorAll('b')).toHaveLength(2)
    expect(loads).toBe(1)
    mounted.dispose()
  })

  it('routes rejection to the nearest error boundary and cancels abandoned resources', async () => {
    const failed = deferred<string>()
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createNarrowCompiledScope()
      return compiledRoot(scope, () =>
        errorBoundary(
          () =>
            Suspense({
              children: () => h(asyncText(failed.promise), null),
              fallback: () => h('p', null, 'waiting'),
            }),
          (error) => h('output', { 'data-error': true }, (error as Error).message),
        ),
      )
    }, host)
    failed.reject(new Error('resource failed'))
    await failed.promise.catch(() => undefined)
    await Promise.resolve()
    expect(host.querySelector('[data-error]')?.textContent).toBe('resource failed')
    mounted.dispose()

    const pending = deferred<string>()
    let cancellations = 0
    const resource = createResource(pending.promise, { cancel: () => (cancellations += 1) })
    const abandonedHost = document.createElement('div')
    const abandoned = mountSuspense(() => {
      const childScope = createNarrowCompiledScope()
      const value = createCompiledAsync(childScope, source(0), resource)
      return compiledRoot(childScope, () => value.get())
    }, abandonedHost)
    abandoned.dispose()
    expect(cancellations).toBe(1)
    pending.resolve('too late')
    await pending.promise
    await Promise.resolve()
    expect(abandonedHost.textContent).toBe('')
  })
})
