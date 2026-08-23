/** @jsxImportSource @vidact/runtime/server */

import {
  createPortal,
  createContext,
  renderToStaticMarkup,
  renderToString,
  useId,
  useContext,
  useState,
  type ServerChild,
} from '@vidact/runtime/server'
import { describe, expect, it } from 'vitest'

describe('server rendering', () => {
  it('serializes deterministic escaped HTML without browser globals', () => {
    const globalObject = globalThis as Record<string, unknown>
    expect(globalObject.document).toBeUndefined()
    expect(globalObject.window).toBeUndefined()

    expect(
      renderToStaticMarkup(() => (
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

    expect(renderToStaticMarkup(() => <Greeting />, { identifierPrefix: 'app-' })).toBe(
      '<p id=":app-r0:">2</p>',
    )
    expect(renderToString(() => <Greeting />, { identifierPrefix: 'app-' })).toBe(
      '<!--vidact:v1:r--><!--vidact:v1:b--><!--vidact:v1:c--><!--vidact:v1:b--><!--vidact:v1:s--><p id=":app-r0:"><!--vidact:v1:b--><!--vidact:v1:t-->2<!--/vidact:v1:t--><!--/vidact:v1:b--></p><!--/vidact:v1:s--><!--/vidact:v1:b--><!--/vidact:v1:c--><!--/vidact:v1:b--><!--/vidact:v1:r-->',
    )
  })

  it('defers component evaluation so nested providers scope their children', () => {
    const Theme = createContext('default')

    function Label(): ServerChild {
      return <span>{useContext(Theme)}</span>
    }

    expect(
      renderToStaticMarkup(
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

  it('marks a single array child as an owned hydration range', () => {
    expect(
      renderToString(() => (
        <ul>
          {['one', 'two'].map((label) => (
            <li>{label}</li>
          ))}
        </ul>
      )),
    ).toBe(
      '<!--vidact:v1:r--><!--vidact:v1:b--><!--vidact:v1:s--><ul><!--vidact:v1:b--><!--vidact:v1:a--><!--vidact:v1:s--><li><!--vidact:v1:b--><!--vidact:v1:t-->one<!--/vidact:v1:t--><!--/vidact:v1:b--></li><!--/vidact:v1:s--><!--vidact:v1:s--><li><!--vidact:v1:b--><!--vidact:v1:t-->two<!--/vidact:v1:t--><!--/vidact:v1:b--></li><!--/vidact:v1:s--><!--/vidact:v1:a--><!--/vidact:v1:b--></ul><!--/vidact:v1:s--><!--/vidact:v1:b--><!--/vidact:v1:r-->',
    )
  })

  it('diagnoses portals on the server target', () => {
    expect(() => renderToString(() => createPortal('content', {}))).toThrow(
      'portals cannot be emitted by the server target',
    )
  })
})
