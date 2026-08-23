import { useState } from 'react'

export function WideSourceMaskApp(): JSX.Element {
  const [value0, _setValue0] = useState(0)
  const [value1, _setValue1] = useState(1)
  const [value2, _setValue2] = useState(2)
  const [value3, _setValue3] = useState(3)
  const [value4, _setValue4] = useState(4)
  const [value5, _setValue5] = useState(5)
  const [value6, _setValue6] = useState(6)
  const [value7, _setValue7] = useState(7)
  const [value8, _setValue8] = useState(8)
  const [value9, _setValue9] = useState(9)
  const [value10, _setValue10] = useState(10)
  const [value11, _setValue11] = useState(11)
  const [value12, _setValue12] = useState(12)
  const [value13, _setValue13] = useState(13)
  const [value14, _setValue14] = useState(14)
  const [value15, _setValue15] = useState(15)
  const [value16, _setValue16] = useState(16)
  const [value17, _setValue17] = useState(17)
  const [value18, _setValue18] = useState(18)
  const [value19, _setValue19] = useState(19)
  const [value20, _setValue20] = useState(20)
  const [value21, _setValue21] = useState(21)
  const [value22, _setValue22] = useState(22)
  const [value23, _setValue23] = useState(23)
  const [value24, _setValue24] = useState(24)
  const [value25, _setValue25] = useState(25)
  const [value26, _setValue26] = useState(26)
  const [value27, _setValue27] = useState(27)
  const [value28, _setValue28] = useState(28)
  const [value29, _setValue29] = useState(29)
  const [value30, _setValue30] = useState(30)
  const [value31, _setValue31] = useState(31)
  const [value32, setValue32] = useState(32)
  const narrowTotal =
    value0 +
    value1 +
    value2 +
    value3 +
    value4 +
    value5 +
    value6 +
    value7 +
    value8 +
    value9 +
    value10 +
    value11 +
    value12 +
    value13 +
    value14 +
    value15 +
    value16 +
    value17 +
    value18 +
    value19 +
    value20 +
    value21 +
    value22 +
    value23 +
    value24 +
    value25 +
    value26 +
    value27 +
    value28 +
    value29 +
    value30 +
    value31

  return (
    <section data-narrow-total={narrowTotal}>
      <button data-increment-wide onClick={() => setValue32((current) => current + 1)}>
        Increment source 32
      </button>
      <output data-wide-value>{value32}</output>
    </section>
  )
}
