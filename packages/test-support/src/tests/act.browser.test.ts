import {
  compiledEffect,
  compiledRoot,
  createCompiledScope,
  createCompiledState,
  h,
  mountCompiled,
  source,
} from '@vidact/runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { act } from '../act.ts'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('act', () => {
  it('drains passive runs, cleanup, and work scheduled by an effect', async () => {
    const countSource = source(0)
    const trace: string[] = []
    let setCount!: (value: number) => void
    const host = document.createElement('div')

    await act(() => {
      dispose = mountCompiled(() => {
        const scope = createCompiledScope()
        const count = createCompiledState(scope, countSource, 0)
        setCount = count.set
        compiledEffect(
          scope,
          countSource,
          () => {
            const snapshot = count.get()
            return () => {
              trace.push(`effect:${snapshot}`)
              if (snapshot === 0) count.set(1)
              return () => trace.push(`cleanup:${snapshot}`)
            }
          },
          () => [count.get()],
        )
        return compiledRoot(scope, () => h('output', null, 'ready'))
      }, host).dispose
    })

    expect(trace).toEqual(['effect:0', 'cleanup:0', 'effect:1'])

    await act(async () => {
      await Promise.resolve()
      setCount(2)
    })
    expect(trace).toEqual(['effect:0', 'cleanup:0', 'effect:1', 'cleanup:1', 'effect:2'])

    await act(() => dispose?.())
    dispose = undefined
    expect(trace).toEqual([
      'effect:0',
      'cleanup:0',
      'effect:1',
      'cleanup:1',
      'effect:2',
      'cleanup:2',
    ])
  })

  it('propagates callback and scheduled-work failures after draining', async () => {
    await expect(
      act(() => {
        throw new Error('callback failed')
      }),
    ).rejects.toThrow('callback failed')

    const host = document.createElement('div')
    await expect(
      act(() => {
        dispose = mountCompiled(() => {
          const scope = createCompiledScope()
          compiledEffect(scope, 0, () => () => {
            throw new Error('effect failed')
          })
          return compiledRoot(scope, () => h('output', null, 'ready'))
        }, host).dispose
      }),
    ).rejects.toThrow('effect failed')
  })
})
