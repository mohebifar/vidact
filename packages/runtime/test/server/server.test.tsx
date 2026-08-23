/** @jsxImportSource @vidact/runtime/server */

import {
  Suspense,
  createPortal,
  createContext,
  lazy,
  renderToStaticMarkup,
  renderToString,
  use as useAsync,
  useId,
  useContext,
  useState,
  type ServerChild,
} from '@vidact/runtime/server'
import { describe, expect, it } from 'vitest'

import {
  jsx as actionJsx,
  renderToStaticMarkup as renderActionsToStaticMarkup,
  useActionState,
  useFormStatus,
  useOptimistic,
} from '../../src/server-actions.ts'
import {
  Profiler as ServerProfiler,
  captureOwnerStack as captureServerOwnerStack,
  jsx as profilingJsx,
  renderToStaticMarkup as renderProfilingToStaticMarkup,
  useDebugValue as useServerDebugValue,
} from '../../src/server-profiling.ts'
import {
  Activity as ServerActivity,
  jsx as retainedJsx,
  renderToStaticMarkup as renderRetainedToStaticMarkup,
  renderToString as renderRetainedToString,
} from '../../src/server.ts'

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

  it('emits deterministic hidden styles for retained Activity roots', () => {
    const activity = () =>
      ServerActivity({
        mode: 'hidden',
        children: () => [
          retainedJsx('section', { children: 'one', style: { color: 'red', display: 'grid' } }),
          retainedJsx('aside', { children: 'two' }),
        ],
      })

    expect(renderRetainedToStaticMarkup(activity)).toBe(
      '<section style="color:red;display:grid;display:none!important">one</section><aside style="display:none!important">two</aside>',
    )
    expect(renderRetainedToString(activity)).toContain('style="display:none!important"')
  })

  it('rejects initially hidden text-only Activity output on the server', () => {
    expect(() =>
      renderRetainedToString(
        retainedJsx(ServerActivity, { mode: 'hidden', children: () => 'private text' }),
      ),
    ).toThrow('initially hidden Activity server children require a host element root')
  })

  it('renders profiling boundaries transparently without invoking development callbacks', () => {
    let callbackCalls = 0
    let formatterCalls = 0
    const output = renderProfilingToStaticMarkup(() =>
      profilingJsx(ServerProfiler, {
        id: 'server',
        onRender: () => {
          callbackCalls += 1
        },
        children: () => {
          useServerDebugValue('value', () => {
            formatterCalls += 1
            return 'formatted'
          })
          return profilingJsx('p', { children: captureServerOwnerStack() ?? 'profiled' })
        },
      }),
    )
    expect(output).toBe('<p>profiled</p>')
    expect(callbackCalls).toBe(0)
    expect(formatterCalls).toBe(0)
  })

  it('diagnoses portals on the server target', () => {
    expect(() => renderToString(() => createPortal('content', {}))).toThrow(
      'portals cannot be emitted by the server target',
    )
  })

  it('renders deterministic async fallbacks and fulfilled resources', async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>((resolvePromise) => {
      resolve = resolvePromise
    })
    const AsyncMessage = (): ServerChild => <strong>{useAsync(pending)}</strong>
    const boundary = () =>
      Suspense({
        children: () => <AsyncMessage />,
        fallback: () => <p>loading</p>,
      })

    expect(renderToStaticMarkup(boundary)).toBe('<p>loading</p>')
    resolve('ready')
    await pending
    await Promise.resolve()
    expect(renderToStaticMarkup(boundary)).toBe('<strong>ready</strong>')
  })

  it('deduplicates lazy module work across server boundary attempts', async () => {
    let resolve!: (module: { default: () => ServerChild }) => void
    const module = new Promise<{ default: () => ServerChild }>((resolvePromise) => {
      resolve = resolvePromise
    })
    let loads = 0
    const Lazy = lazy(() => {
      loads += 1
      return module
    })
    const boundary = () =>
      Suspense({
        children: () => <Lazy />,
        fallback: () => 'pending',
      })

    expect(renderToStaticMarkup(boundary)).toBe('pending')
    expect(renderToStaticMarkup(boundary)).toBe('pending')
    expect(loads).toBe(1)
    resolve({ default: () => <em>loaded</em> })
    await module
    await Promise.resolve()
    expect(renderToStaticMarkup(boundary)).toBe('<em>loaded</em>')
    expect(loads).toBe(1)
  })

  it('renders deterministic Actions state and permalink fallbacks', () => {
    function Form(): ServerChild {
      const [value, submit, pending] = useActionState(
        async () => 'next',
        'initial',
        '/save?return="list"&ready=true',
      )
      const [optimistic] = useOptimistic(value)
      const status = useFormStatus()
      return actionJsx('form', {
        action: submit,
        children: actionJsx('button', {
          formAction: submit,
          children: pending || status.pending ? 'saving' : optimistic,
        }),
      })
    }

    const html = renderActionsToStaticMarkup(() => actionJsx(Form, {}))
    expect(html).toContain('action="/save?return=&quot;list&quot;&amp;ready=true"')
    expect(html).toContain('formaction="/save?return=&quot;list&quot;&amp;ready=true"')
    expect(html).toContain('>initial</button>')
  })
})
