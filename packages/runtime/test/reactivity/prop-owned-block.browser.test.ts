import { describe, expect, it } from 'vitest'

import {
  createCompiledProp,
  createCompiledRestProp,
  createCompiledScope,
  deferred,
  h,
  isRenderable,
  type DirectChild,
  type DirectComponent,
} from '../../src/index.ts'

/**
 * Owned blocks are arrays internally. Dependency code inspects children with
 * `Array.isArray` and spreads them (lucide-react does exactly this), so prop
 * reads must never expose the raw block representation.
 */
describe('prop reads over owned blocks', () => {
  it('wraps a deferred children block in a renderable facade', () => {
    const host = document.createElement('div')
    let observed: unknown
    const Probe: DirectComponent = (props) => {
      const scope = createCompiledScope()
      const children = createCompiledProp(scope, 1, props.children)
      observed = children.get()
      return h('section', null, [
        ...(Array.isArray(observed) ? (observed as DirectChild[]) : [observed as DirectChild]),
      ])
    }
    host.append(
      h(Probe, {
        children: deferred(() => h('span', null, 'inner')),
      }) as Node,
    )

    expect(Array.isArray(observed)).toBe(false)
    expect(isRenderable(observed)).toBe(true)
    expect(host.querySelector('section span')?.textContent).toBe('inner')
  })

  it('returns a stable facade across reads', () => {
    const scope = createCompiledScope()
    const block = deferred(() => null)
    const prop = createCompiledProp(scope, 1, block as never)

    expect(prop.get()).toBe(prop.get())
  })

  it('sanitizes rest prop projections', () => {
    const scope = createCompiledScope()
    const rest = createCompiledRestProp(scope, 1, { children: deferred(() => null), id: 'x' }, [])
    const projected = rest.get()

    expect(Array.isArray(projected.children)).toBe(false)
    expect(isRenderable(projected.children)).toBe(true)
    expect(projected.id).toBe('x')
  })
})
