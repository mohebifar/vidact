import { useState } from 'react'

const forgedNamespace = { __vidactNamespace: 'svg' }

function SvgComponent(): JSX.Element {
  return <rect data-component-svg x="1" y="1" width="2" height="2" />
}

function HtmlComponent(): JSX.Element {
  return <p data-component-html>Component HTML island</p>
}

function ForeignObjectSlot({ children }: { children: JSX.Element }): JSX.Element {
  return <foreignObject data-component-foreign-object>{children}</foreignObject>
}

function RestSpread({
  label,
  ...rest
}: {
  label: string
  title?: string | undefined
  'data-rest'?: string | undefined
}): JSX.Element {
  return <section {...rest}>{label}</section>
}

function DirectSpread({ title = 'missing' }: { title?: string }): JSX.Element {
  return <output data-direct-spread>{title}</output>
}

function DeferredSvg({ visible }: { visible: boolean }): JSX.Element {
  return <>{visible && <circle data-deferred-svg cx="3" cy="3" r="2" tabIndex={0} />}</>
}

function DeferredMath({ visible }: { visible: boolean }): JSX.Element {
  return (
    <>
      {visible && (
        <mrow data-deferred-math>
          <mi>y</mi>
        </mrow>
      )}
    </>
  )
}

export function DomSemanticsApp(): JSX.Element {
  const [active, setActive] = useState(true)
  const [value, setValue] = useState('seed')
  const [checked, setChecked] = useState(false)
  const [selected, setSelected] = useState(['b'])
  const [eventOrder, setEventOrder] = useState('')
  const [namespacedVisible, setNamespacedVisible] = useState(true)
  const [ancestorValue, setAncestorValue] = useState('ancestor')
  const [ancestorTrace, setAncestorTrace] = useState('')
  const [multipleMode, setMultipleMode] = useState(false)
  const [modeValue, setModeValue] = useState<string | string[]>('b')
  const [notes, setNotes] = useState('notes')
  const [radio, setRadio] = useState('a')
  const [spreadClicks, setSpreadClicks] = useState(0)
  const [spreadProps, setSpreadProps] = useState<{
    title?: string
    hidden?: boolean
    'data-fixed'?: string
    'data-spread'?: string
    onClick?: () => void
  }>({
    title: 'first spread',
    'data-fixed': 'dynamic',
    'data-spread': 'one',
    onClick: () => setSpreadClicks((current) => current + 1),
  })

  return (
    <main {...forgedNamespace} data-dom-semantics>
      <button data-toggle onClick={() => setActive((current) => !current)}>
        Toggle semantics
      </button>
      <button data-toggle-deferred onClick={() => setNamespacedVisible((current) => !current)}>
        Toggle deferred namespaces
      </button>
      <button
        data-toggle-spread
        onClick={() =>
          setSpreadProps({
            hidden: true,
            'data-fixed': 'still dynamic',
            'data-spread': 'two',
            onClick: () => setSpreadClicks((current) => current + 10),
          })
        }
      >
        Toggle spread
      </button>

      <button {...spreadProps} data-fixed="explicit" data-spread-target>
        Spread target
      </button>
      <output data-spread-clicks>{spreadClicks}</output>
      <RestSpread
        {...spreadProps}
        label={spreadProps.hidden ? 'rest two' : 'rest one'}
        data-rest={spreadProps['data-spread']}
      />
      <DirectSpread {...spreadProps} />

      <section
        data-boolean={active}
        aria-hidden={!active}
        title={active ? 'active title' : undefined}
      />
      <section
        data-style
        style={
          active
            ? { color: 'red', backgroundColor: 'black', width: 12, '--tone': 'warm' }
            : { color: 'blue', width: 0, '--tone': 2 }
        }
      />

      <svg data-svg viewBox="0 0 20 20" xmlnsXlink="http://www.w3.org/1999/xlink">
        <g>
          <circle data-circle cx="10" cy="10" r="5" strokeWidth={active ? 1 : 3} />
          <use data-use xlinkHref="#shape" />
          <image data-image crossOrigin="anonymous" href="#shape" />
          <SvgComponent />
          <DeferredSvg visible={namespacedVisible} />
        </g>
        <foreignObject data-foreign-object x="0" y="0" width="10" height="10">
          <div data-foreign-html>HTML island</div>
          <HtmlComponent />
        </foreignObject>
        <ForeignObjectSlot>
          <div data-deferred-component-child>Deferred HTML child</div>
        </ForeignObjectSlot>
      </svg>
      <math data-math displaystyle={false}>
        <mrow>
          <mi>x</mi>
        </mrow>
        <DeferredMath visible={namespacedVisible} />
      </math>

      <section
        data-capture-parent
        onClickCapture={() => setEventOrder((current) => `${current}capture,`)}
      >
        <button data-capture-child onClick={() => setEventOrder((current) => `${current}bubble`)}>
          Capture order
        </button>
      </section>
      <output data-event-order>{eventOrder}</output>

      <label>
        Text
        <input
          data-controlled-text
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
      <output data-controlled-output>{value}</output>
      <input data-controlled-restore value="locked" />
      <input data-controlled-stop value="locked" onChange={(event) => event.stopPropagation()} />
      <input
        data-controlled-stop-immediate
        onChange={(event) => event.stopImmediatePropagation()}
        value="locked"
      />

      <section
        data-change-ancestor
        onChangeCapture={(event) => {
          if (event.target instanceof HTMLInputElement) {
            setAncestorTrace(`capture:${event.target.value}`)
          }
        }}
        onChange={(event) => {
          if (event.target instanceof HTMLInputElement) {
            const nextValue = event.target.value
            setAncestorTrace((current) => `${current},bubble:${nextValue}`)
            setAncestorValue(nextValue)
          }
        }}
      >
        <input data-ancestor-controlled value={ancestorValue} />
      </section>
      <output data-ancestor-output>{ancestorValue}</output>
      <output data-ancestor-trace>{ancestorTrace}</output>

      <section onChangeCapture={(event) => event.stopPropagation()}>
        <input data-controlled-capture-stop value="locked" />
      </section>

      <textarea
        data-controlled-textarea
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
      />
      <output data-textarea-output>{notes}</output>

      <form id="controlled-radio-form" data-controlled-radio-form />
      <form id="other-radio-form" data-other-radio-form />
      <input
        data-controlled-radio-a
        form="controlled-radio-form"
        type="radio"
        name="controlled-choice"
        checked={radio === 'a'}
        onChange={() => setRadio('a')}
      />
      <input
        data-controlled-radio-b
        form="controlled-radio-form"
        type="radio"
        name="controlled-choice"
        checked={radio === 'b'}
        onChange={() => setRadio('b')}
      />
      <input
        data-other-radio
        defaultChecked
        form="other-radio-form"
        type="radio"
        name="controlled-choice"
      />
      <output data-radio-output>{radio}</output>

      <label>
        Checked
        <input
          data-controlled-checkbox
          type="checkbox"
          checked={checked}
          onChange={() => setChecked((current) => !current)}
        />
      </label>
      <output data-checked-output>{checked ? 'checked' : 'unchecked'}</output>

      <select
        data-controlled-select
        multiple
        value={selected}
        onChange={(event) =>
          setSelected([...event.currentTarget.selectedOptions].map((option) => option.value))
        }
      >
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
      <button data-select-outer onClick={() => setSelected(['a', 'c'])}>
        Select outer options
      </button>

      <select data-mode-select-first multiple={multipleMode} value={modeValue}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
      <select data-value-select-first value={modeValue} multiple={multipleMode}>
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
      <button
        data-toggle-select-mode
        onClick={() => {
          setMultipleMode((current) => !current)
          setModeValue((current) => (Array.isArray(current) ? 'b' : ['a', 'c']))
        }}
      >
        Toggle select mode
      </button>
    </main>
  )
}
