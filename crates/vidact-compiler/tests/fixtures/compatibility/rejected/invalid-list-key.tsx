import { useState } from 'react'

export function InvalidListKey() {
  const [items] = useState([{ id: 'one' }])
  return <ul>{items.map((item) => <li key={`${item.id}:row`}>{item.id}</li>)}</ul>
}
