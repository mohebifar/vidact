/** @jsxImportSource @vidact/runtime/server */

import { describe, expect, it } from 'vitest'

import {
  createContext,
  renderToStaticMarkup,
  renderToString,
  useId,
  useContext,
  useState,
  type ServerChild,
} from '../../src/server.ts'

describe('server rendering', () => {
  it('serializes deterministic escaped HTML without browser globals', () => {
    const globalObject = globalThis as Record<string, unknown>
    expect(globalObject.document).toBeUndefined()
    expect(globalObject.window).toBeUndefined()

    expect(
      renderToString(() => (
        <main className="shell" data-label={'a"<&'} hidden style={{ lineHeight: 1.2, width: 4 }}>
          {'Hello <script>& goodbye'}
          <input disabled />
        </main>
      )),
    ).toBe(
      '<main class="shell" data-label="a&quot;&lt;&amp;" hidden="" style="line-height:1.2;width:4px">Hello &lt;script&gt;&amp; goodbye<input disabled=""></main>',
    )
  })

  it('evaluates initial state and produces request-deterministic ids', () => {
    function Greeting(): ServerChild {
      const [count] = useState(() => 2)
      const id = useId()
      return <p id={id}>{count}</p>
    }

    expect(renderToString(() => <Greeting />, { identifierPrefix: 'app-' })).toBe(
      '<p id=":app-v0:">2</p>',
    )
    expect(renderToStaticMarkup(() => <Greeting />, { identifierPrefix: 'app-' })).toBe(
      '<p id=":app-v0:">2</p>',
    )
  })

  it('defers component evaluation so nested providers scope their children', () => {
    const Theme = createContext('default')

    function Label(): ServerChild {
      return <span>{useContext(Theme)}</span>
    }

    expect(
      renderToString(
        <Theme.Provider value="outer">
          <Label />
          <Theme.Provider value="inner">
            <Label />
          </Theme.Provider>
          <Label />
        </Theme.Provider>,
      ),
    ).toBe('<span>outer</span><span>inner</span><span>outer</span>')
  })

  it('rejects unbranded object children instead of stringifying them', () => {
    expect(() => renderToString({ value: '<unsafe>' } as never)).toThrow(
      'unsupported server child value',
    )
  })
})
