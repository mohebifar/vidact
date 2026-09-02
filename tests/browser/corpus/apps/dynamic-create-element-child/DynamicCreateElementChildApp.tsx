import * as React from 'react'
import { useState } from 'react'

function DynamicContainer({ label, tag: Tag }: { label: string; tag: 'section' }): JSX.Element {
  const props = { 'data-dynamic-target': '', 'data-dynamic-label': label }
  // @ts-expect-error React descriptors are replaced by Vidact's guarded direct intrinsic path.
  return React.createElement(Tag, props, <span data-dynamic-child>{label}</span>)
}

export function DynamicCreateElementChildApp(): JSX.Element {
  const [label, setLabel] = useState('First')

  return (
    <main data-dynamic-create-element-app>
      <button data-update-dynamic-child onClick={() => setLabel('Second')}>
        Update
      </button>
      <DynamicContainer label={label} tag="section" />
      <p data-stable-dynamic-sibling>Stable</p>
    </main>
  )
}
