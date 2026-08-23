import { mountCompiled } from '@vidact/runtime'
import { startMutationCapture } from '@vidact/test-support'
import { afterEach, describe, expect, it } from 'vitest'

import {
  FunctionChildApp,
  ObjectChildApp,
  PromiseChildApp,
  SymbolChildApp,
} from './RuntimeValuesApp.tsx'

afterEach(() => {
  document.body.replaceChildren()
})

describe('compiled runtime child values', () => {
  it('rejects unsupported categories without disturbing existing host DOM', () => {
    for (const component of [ObjectChildApp, FunctionChildApp, SymbolChildApp, PromiseChildApp]) {
      const host = document.createElement('div')
      const previous = document.createElement('p')
      previous.textContent = 'previous'
      host.append(previous)
      document.body.append(host)
      const mutations = startMutationCapture(host)

      expect(() => mountCompiled(component, host)).toThrow(/unsupported direct child/i)
      expect(mutations.stop()).toEqual([])
      expect(host.childNodes).toHaveLength(1)
      expect(host.firstChild).toBe(previous)
      expect(host.textContent).toBe('previous')

      host.remove()
    }
  })
})
