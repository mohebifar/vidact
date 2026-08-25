import {
  assertMutationEnvelope,
  captureMutations,
  requireSingleDirectText,
} from '@vidact/test-support'
import { describe, expect, it } from 'vitest'

import {
  ActionForm,
  createCompiledActionState,
  createCompiledFormStatus,
  createCompiledOptimistic,
} from '../../src/actions.ts'
import { startTransition } from '../../src/concurrent.ts'
import {
  binding,
  combineSources,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  deferred,
  h,
  mountCompiled,
  source,
  when,
} from '../../src/index.ts'
import { flushScheduledTasks } from '../../src/testing.ts'

async function publishTransitions(): Promise<void> {
  await Promise.resolve()
  flushScheduledTasks()
  await Promise.resolve()
  flushScheduledTasks()
}

describe('Actions', () => {
  it('queues async actions in order and keeps pending state until the queue drains', async () => {
    const stateSource = source(0)
    const pendingSource = source(1)
    const releases: Array<(value: string) => void> = []
    const calls: Array<readonly [string, string]> = []
    let dispatch!: (payload: string) => void
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const action = createCompiledActionState(
        scope,
        stateSource,
        pendingSource,
        (previous: string, payload: string) => {
          calls.push([previous, payload])
          return new Promise<string>((resolve) => releases.push(resolve))
        },
        '',
      )
      dispatch = action.set
      return compiledRoot(scope, () =>
        h(
          'output',
          null,
          binding(scope, combineSources(stateSource, pendingSource), () => {
            const snapshot = action.get()
            return `${snapshot.pending ? 'pending' : 'idle'}:${snapshot.value}`
          }),
        ),
      )
    }, host)

    dispatch('first')
    dispatch('second')
    expect(host.textContent).toBe('pending:')
    expect(calls).toEqual([['', 'first']])

    releases.shift()!('one')
    await publishTransitions()
    expect(calls).toEqual([
      ['', 'first'],
      ['one', 'second'],
    ])
    expect(host.textContent).toBe('pending:one')

    releases.shift()!('two')
    await publishTransitions()
    expect(host.textContent).toBe('idle:two')
    mounted.dispose()
  })

  it('does not let an unrelated transition cancel an action result', async () => {
    const actionSource = source(0)
    const pendingSource = source(1)
    const unrelatedSource = source(2)
    let dispatch!: (payload: void) => void
    let publish!: (value: string) => void
    let updateUnrelated!: () => void
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const action = createCompiledActionState(
        scope,
        actionSource,
        pendingSource,
        (_previous, _payload: void) => new Promise<string>((resolve) => (publish = resolve)),
        'initial',
      )
      const unrelated = createCompiledState(scope, unrelatedSource, 'initial')
      dispatch = action.set
      updateUnrelated = () => startTransition(() => unrelated.replace('updated'))
      return compiledRoot(scope, () =>
        h(
          'output',
          null,
          binding(
            scope,
            combineSources(actionSource, unrelatedSource),
            () => `${action.get().value}:${unrelated.get()}`,
          ),
        ),
      )
    }, host)

    dispatch(undefined)
    publish('committed')
    await Promise.resolve()
    updateUnrelated()
    flushScheduledTasks()
    expect(host.textContent).toBe('committed:updated')
    mounted.dispose()
  })

  it('publishes optimistic state urgently, then rebases it atomically on action success', async () => {
    const stateSource = source(0)
    const pendingSource = source(1)
    const optimisticSource = source(2)
    let dispatch!: (payload: string) => void
    let release!: (value: string) => void
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      let optimistic!: ReturnType<typeof createCompiledOptimistic<string, string>>
      const action = createCompiledActionState(
        scope,
        stateSource,
        pendingSource,
        (_previous: string, payload: string) => {
          optimistic.set(payload)
          return new Promise<string>((resolve) => {
            release = resolve
          })
        },
        'base',
      )
      optimistic = createCompiledOptimistic(
        scope,
        stateSource,
        optimisticSource,
        () => action.get().value,
        (_current, update) => update,
      )
      dispatch = action.set
      return compiledRoot(scope, () =>
        h('output', null, binding(scope, optimisticSource, optimistic.get)),
      )
    }, host)
    const output = host.querySelector('output')!
    const text = requireSingleDirectText(output)

    const optimisticCapture = await captureMutations(host, () => dispatch('optimistic'))
    expect(host.textContent).toBe('optimistic')
    expect(host.querySelector('output')).toBe(output)
    expect(() =>
      assertMutationEnvelope(
        optimisticCapture.records,
        [{ type: 'characterData', target: text }],
        'optimistic action publication',
      ),
    ).not.toThrow()

    release('committed')
    await publishTransitions()
    expect(host.textContent).toBe('committed')
    expect(host.querySelector('output')).toBe(output)
    mounted.dispose()
  })

  it('rolls back an optimistic layer when its reducer throws', async () => {
    const stateSource = source(0)
    const pendingSource = source(1)
    const optimisticSource = source(2)
    const failures: unknown[] = []
    let dispatch!: () => void
    let updateBase!: (value: string) => void
    const failure = new Error('optimistic reducer failed')
    const host = document.createElement('div')
    const mounted = mountCompiled(
      () => {
        const scope = createCompiledScope()
        const base = createCompiledState(scope, stateSource, 'base')
        let optimistic!: ReturnType<typeof createCompiledOptimistic<string, string>>
        const action = createCompiledActionState(
          scope,
          source(3),
          pendingSource,
          () => {
            optimistic.set('bad')
            return 'unused'
          },
          'initial',
        )
        optimistic = createCompiledOptimistic(
          scope,
          stateSource,
          optimisticSource,
          base.get,
          (current, update) => {
            if (update === 'bad') throw failure
            return current + update
          },
        )
        dispatch = () => action.set(undefined)
        updateBase = base.replace
        return compiledRoot(scope, () =>
          h('output', null, binding(scope, optimisticSource, optimistic.get)),
        )
      },
      host,
      { onUncaughtError: (error) => failures.push(error) },
    )

    dispatch()
    await publishTransitions()
    expect(failures).toEqual([failure])
    expect(host.textContent).toBe('base')
    updateBase('next')
    expect(host.textContent).toBe('next')
    mounted.dispose()
  })

  it('publishes form status, includes the submitter, and restores reset form controls', async () => {
    const controlledSource = source(0)
    const releasedSource = source(1)
    let finish!: () => void
    let submitted!: FormData
    let latestStatus!: ReturnType<typeof createCompiledFormStatus>['get']
    let releaseControl!: () => void
    let resetEvents = 0
    const action = (data: FormData): Promise<void> => {
      submitted = data
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    }
    const Status = () => {
      const scope = createCompiledScope()
      const status = createCompiledFormStatus(scope, source(0))
      latestStatus = status.get
      return compiledRoot(scope, () =>
        h(
          'span',
          { 'data-status': true },
          binding(scope, source(0), () => (status.get().pending ? 'submitting' : 'idle')),
        ),
      )
    }
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const controlled = createCompiledState(scope, controlledSource, 'locked')
      const released = createCompiledState<string | undefined>(scope, releasedSource, 'controlled')
      releaseControl = () => released.replace(undefined)
      return compiledRoot(scope, () =>
        h(
          ActionForm,
          { action, onReset: () => (resetEvents += 1) },
          h('input', { name: 'title', defaultValue: 'initial' }),
          h('input', {
            name: 'controlled',
            value: binding(scope, controlledSource, controlled.get),
          }),
          h('input', {
            name: 'released',
            defaultValue: 'released-default',
            value: binding(scope, releasedSource, released.get),
          }),
          deferred(() => h(Status, null)),
          h('button', { type: 'submit', name: 'intent', value: 'save' }, 'save'),
        ),
      )
    }, host)
    const form = host.querySelector('form')!
    const title = form.elements.namedItem('title') as HTMLInputElement
    const controlled = form.elements.namedItem('controlled') as HTMLInputElement
    const released = form.elements.namedItem('released') as HTMLInputElement
    const submitter = form.querySelector('button')!
    const statusNode = host.querySelector('[data-status]')!
    title.value = 'changed'
    controlled.value = 'tampered'
    releaseControl()
    released.value = 'released-user-value'

    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
    expect(statusNode.textContent).toBe('submitting')
    expect(latestStatus()).toMatchObject({ pending: true, data: submitted, method: 'post', action })
    expect(submitted.get('title')).toBe('changed')
    expect(submitted.get('controlled')).toBe('tampered')
    expect(submitted.get('released')).toBe('released-user-value')
    expect(submitted.get('intent')).toBe('save')

    finish()
    await publishTransitions()
    expect(statusNode.textContent).toBe('idle')
    expect(title.value).toBe('initial')
    expect(controlled.value).toBe('locked')
    expect(released.value).toBe('released-default')
    expect(resetEvents).toBe(0)
    expect(host.querySelector('form')).toBe(form)
    expect(host.querySelector('[data-status]')).toBe(statusNode)
    mounted.dispose()
  })

  it('lets a submitter function action override the form action', () => {
    const calls: string[] = []
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          ActionForm,
          { action: () => calls.push('form') },
          h('button', { type: 'submit', formAction: () => calls.push('submitter') }, 'override'),
        ),
      )
    }, host)
    const form = host.querySelector('form')!
    const submitter = form.querySelector('button')!

    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
    expect(calls).toEqual(['submitter'])
    mounted.dispose()
  })

  it('lets a submitter URL action bypass the form function action', () => {
    const calls: string[] = []
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          ActionForm,
          { action: () => calls.push('form') },
          h('button', { type: 'submit', formAction: '/native' }, 'native'),
        ),
      )
    }, host)
    const form = host.querySelector('form')!
    const submitter = form.querySelector('button')!
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter })

    form.dispatchEvent(event)
    expect(calls).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    mounted.dispose()
  })

  it('keeps the latest form status pending until overlapping submissions settle', async () => {
    const releases: Array<() => void> = []
    const submitted: FormData[] = []
    let latestStatus!: ReturnType<typeof createCompiledFormStatus>['get']
    const action = (data: FormData): Promise<void> => {
      submitted.push(data)
      return new Promise<void>((resolve) => releases.push(resolve))
    }
    const Status = () => {
      const scope = createCompiledScope()
      const status = createCompiledFormStatus(scope, source(0))
      latestStatus = status.get
      return compiledRoot(scope, () =>
        h(
          'span',
          null,
          binding(scope, source(0), () => (status.get().pending ? 'pending' : 'idle')),
        ),
      )
    }
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      return compiledRoot(scope, () =>
        h(
          ActionForm,
          { action },
          h('input', { name: 'title', defaultValue: 'initial' }),
          deferred(() => h(Status, null)),
          h('button', { type: 'submit' }, 'save'),
        ),
      )
    }, host)
    const form = host.querySelector('form')!
    const title = form.elements.namedItem('title') as HTMLInputElement
    const submitter = form.querySelector('button')!

    title.value = 'first'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
    title.value = 'second'
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }))
    expect(submitted.map((data) => data.get('title'))).toEqual(['first', 'second'])
    expect(latestStatus()).toMatchObject({ pending: true, data: submitted[1], action })

    releases[1]!()
    await publishTransitions()
    expect(latestStatus()).toMatchObject({ pending: true, data: submitted[1], action })
    expect(title.value).toBe('second')

    releases[0]!()
    await publishTransitions()
    expect(latestStatus()).toEqual({ pending: false, data: null, method: 'get', action: null })
    expect(title.value).toBe('initial')
    mounted.dispose()
  })

  it('keeps form status context for descendants mounted after construction', () => {
    const visibleSource = source(0)
    let show!: () => void
    const Status = () => {
      const scope = createCompiledScope()
      const status = createCompiledFormStatus(scope, source(0))
      return compiledRoot(scope, () =>
        h(
          'span',
          { 'data-late-status': true },
          binding(scope, source(0), () => (status.get().pending ? 'pending' : 'idle')),
        ),
      )
    }
    const host = document.createElement('div')
    const mounted = mountCompiled(() => {
      const scope = createCompiledScope()
      const visible = createCompiledState(scope, visibleSource, false)
      show = () => visible.replace(true)
      return compiledRoot(scope, () =>
        h(
          ActionForm,
          { action: () => new Promise<void>(() => {}) },
          deferred(() => when(scope, visibleSource, visible.get, () => h(Status, null))),
          h('button', { type: 'submit' }, 'save'),
        ),
      )
    }, host)

    expect(host.querySelector('[data-late-status]')).toBeNull()
    show()
    expect(host.querySelector('[data-late-status]')?.textContent).toBe('idle')
    const form = host.querySelector('form')!
    form.dispatchEvent(
      new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true,
        submitter: form.querySelector('button'),
      }),
    )
    expect(host.querySelector('[data-late-status]')?.textContent).toBe('pending')
    mounted.dispose()
  })

  it('keeps form values after a failed action and routes the error through the root', async () => {
    let fail!: (error: unknown) => void
    const failures: unknown[] = []
    const host = document.createElement('div')
    const mounted = mountCompiled(
      () => {
        const scope = createCompiledScope()
        return compiledRoot(scope, () =>
          h(
            ActionForm,
            {
              action: () =>
                new Promise<void>((_resolve, reject) => {
                  fail = reject
                }),
            },
            h('input', { name: 'title', defaultValue: 'initial' }),
            h('button', { type: 'submit' }, 'save'),
          ),
        )
      },
      host,
      { onUncaughtError: (error) => failures.push(error) },
    )
    const form = host.querySelector('form')!
    const title = form.elements.namedItem('title') as HTMLInputElement
    title.value = 'keep me'
    form.dispatchEvent(
      new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true,
        submitter: form.querySelector('button'),
      }),
    )

    const failure = new Error('action failed')
    fail(failure)
    await publishTransitions()
    expect(failures).toEqual([failure])
    expect(title.value).toBe('keep me')
    expect(host.querySelector('form')).toBe(form)
    mounted.dispose()
  })
})
