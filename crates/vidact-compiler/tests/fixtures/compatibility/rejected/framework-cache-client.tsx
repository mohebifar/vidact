import { cache } from 'react'

const read = cache(() => 'value')

export function FrameworkCacheClient(): JSX.Element {
  return <main>{read()}</main>
}
