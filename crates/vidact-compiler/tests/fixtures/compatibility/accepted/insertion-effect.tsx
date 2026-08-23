import { useInsertionEffect, useState } from 'react'

export function InsertionEffect() {
  const [theme, setTheme] = useState('red')
  useInsertionEffect(() => console.log(theme), [theme])
  return <button onClick={() => setTheme('blue')}>{theme}</button>
}
