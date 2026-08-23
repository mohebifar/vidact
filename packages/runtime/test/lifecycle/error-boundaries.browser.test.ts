import { afterEach, describe, expect, it } from 'vitest'

import {
  binding,
  compiledEffect,
  compiledEvent,
  compiledRoot,
  createPortal,
  createCompiledScope,
  createCompiledState,
  errorBoundary,
  h,
  mountCompiled,
  source,
} from '../../src/index.ts'

afterEach(() => document.body.replaceChildren())

describe('compiled error boundaries', () => {
  it('rolls back failed updates before publishing a recoverable fallback', () => {
    const valueSource = source(0)
    const caught: unknown[] = []
    const local: unknown[] = []
    let setValue!: (value: number) => void
    let reset!: () => void
    const host = document.createElement('div')
    const mounted = mountCompiled(
      () => {
        const scope = createCompiledScope()
        const value = createCompiledState(scope, valueSource, 1)
        setValue = value.set
        const boundary = errorBoundary(
          () =>
            h(
              'output',
              { 'data-content': true },
              binding(scope, valueSource, () => {
                const next = value.get()
                if (next === 2) throw new Error('content failed')
                return next
              }),
            ),
          (error, retry) => {
            reset = retry
            return h('p', { 'data-fallback': true }, (error as Error).message)
          },
          (error) => local.push(error),
        )
        return compiledRoot(scope, () => boundary)
      },
      host,
      { onCaughtError: (error) => caught.push(error) },
    )

    const content = host.querySelector('[data-content]')
    expect(content?.textContent).toBe('1')

    expect(() => setValue(2)).not.toThrow()
    expect(content?.isConnected).toBe(false)
    expect(host.querySelector('[data-fallback]')?.textContent).toBe('content failed')
    expect(local).toHaveLength(1)
    expect(caught).toEqual(local)

    setValue(3)
    reset()
    expect(host.querySelector('[data-content]')?.textContent).toBe('3')
    expect(host.querySelector('[data-fallback]')).toBeNull()
    mounted.dispose()
  })

  it('routes event and passive effect failures through the logical boundary', async () => {
    const triggerSource = source(0)
    const failures: string[] = []
    let trigger!: () => void
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const count = createCompiledState(scope, triggerSource, 0)
      trigger = () => count.set((value) => value + 1)
      const boundary = errorBoundary(
        () => {
          compiledEffect(
            scope,
            triggerSource,
            () => () => {
              if (count.get() === 1) throw new Error('passive failed')
            },
            () => [count.get()],
          )
          return h('button', {
            'data-event': true,
            onClick: compiledEvent(scope, () => {
              throw new Error('event failed')
            }),
          })
        },
        (error) => h('p', { 'data-fallback': true }, (error as Error).message),
        (error) => failures.push((error as Error).message),
      )
      return compiledRoot(scope, () => boundary)
    }, host)

    host.querySelector<HTMLButtonElement>('[data-event]')!.click()
    expect(host.querySelector('[data-fallback]')?.textContent).toBe('event failed')
    expect(failures).toEqual(['event failed'])
    mounted.dispose()

    const passiveHost = document.createElement('div')
    const passive = mountCompiled(() => {
      const scope = createCompiledScope()
      const count = createCompiledState(scope, triggerSource, 0)
      trigger = () => count.set((value) => value + 1)
      const boundary = errorBoundary(
        () => {
          compiledEffect(
            scope,
            triggerSource,
            () => () => {
              if (count.get() === 1) throw new Error('passive failed')
            },
            () => [count.get()],
          )
          return h('output', null, 'ready')
        },
        (error) => h('p', { 'data-fallback': true }, (error as Error).message),
        (error) => failures.push((error as Error).message),
      )
      return compiledRoot(scope, () => boundary)
    }, passiveHost)

    await Promise.resolve()
    trigger()
    await Promise.resolve()
    expect(passiveHost.querySelector('[data-fallback]')?.textContent).toBe('passive failed')
    expect(failures).toEqual(['event failed', 'passive failed'])
    passive.dispose()
  })

  it('reports uncaught mount and update failures at the root', () => {
    const errors: unknown[] = []
    const host = document.createElement('div')
    host.textContent = 'previous'
    const mounted = mountCompiled(
      () => {
        throw new Error('mount failed')
      },
      host,
      { onUncaughtError: (error) => errors.push(error) },
    )

    expect(errors.map((error) => (error as Error).message)).toEqual(['mount failed'])
    expect(host.textContent).toBe('previous')
    expect(() => mounted.dispose()).not.toThrow()

    const valueSource = source(0)
    let setValue!: (value: number) => void
    const updateHost = document.createElement('div')
    const updated = mountCompiled(
      () => {
        const scope = createCompiledScope()
        const value = createCompiledState(scope, valueSource, 1)
        setValue = value.set
        return compiledRoot(scope, () =>
          h(
            'output',
            null,
            binding(scope, valueSource, () => {
              const next = value.get()
              if (next === 2) throw new Error('update failed')
              return next
            }),
          ),
        )
      },
      updateHost,
      { onUncaughtError: (error) => errors.push(error) },
    )

    setValue(2)
    expect(updateHost.textContent).toBe('1')
    setValue(3)
    expect(updateHost.textContent).toBe('3')
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'mount failed',
      'update failed',
    ])
    updated.dispose()
  })

  it('rolls back commit failures and follows logical ownership through portals', () => {
    const tag = `vidact-boundary-failure-${crypto.randomUUID()}`
    customElements.define(
      tag,
      class extends HTMLElement {
        set value(next: string) {
          if (next === 'broken') throw new Error('commit failed')
          this.dataset.value = next
        }
      },
    )
    const valueSource = source(0)
    let setValue!: (value: string) => void
    const host = document.createElement('div')
    const portalHost = document.createElement('aside')
    document.body.append(host, portalHost)
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const value = createCompiledState(scope, valueSource, 'ready')
      setValue = value.set
      const boundary = errorBoundary(
        () =>
          h(
            'section',
            null,
            h(tag, { value: binding(scope, valueSource, value.get) }),
            createPortal(
              h('button', {
                'data-portal-failure': true,
                onClick: compiledEvent(scope, () => {
                  throw new Error('portal failed')
                }),
              }),
              portalHost,
            ),
          ),
        (error) => h('p', { 'data-fallback': true }, (error as Error).message),
      )
      return compiledRoot(scope, () => boundary)
    }, host)
    const retained = host.querySelector<HTMLElement>(tag)!

    setValue('broken')
    expect(host.querySelector('[data-fallback]')?.textContent).toBe('commit failed')
    expect(retained.dataset.value).toBe('ready')
    expect(retained.isConnected).toBe(false)
    expect(portalHost.childNodes).toHaveLength(0)
    mounted.dispose()

    const portalMounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const boundary = errorBoundary(
        () =>
          createPortal(
            h('button', {
              'data-portal-failure': true,
              onClick: compiledEvent(scope, () => {
                throw new Error('portal failed')
              }),
            }),
            portalHost,
          ),
        (error) => h('p', { 'data-fallback': true }, (error as Error).message),
      )
      return compiledRoot(scope, () => boundary)
    }, host)

    portalHost.querySelector<HTMLButtonElement>('[data-portal-failure]')!.click()
    expect(host.querySelector('[data-fallback]')?.textContent).toBe('portal failed')
    expect(portalHost.childNodes).toHaveLength(0)
    portalMounted.dispose()
  })
})
