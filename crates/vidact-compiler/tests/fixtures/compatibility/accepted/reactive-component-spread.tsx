import { useState } from 'react'

function Child({ label = 'missing', ...rest }) {
  return <output {...rest}>{label}</output>
}

export function ReactiveComponentSpread() {
  const [props, setProps] = useState({ label: 'first', title: 'present' })
  return <Child {...props} data-fixed="explicit" />
}
