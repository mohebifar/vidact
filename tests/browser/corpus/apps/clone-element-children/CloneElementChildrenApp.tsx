import * as React from 'react'
import { useState } from 'react'

type Renderable = { props: Record<string, unknown> }

function ChildSlot({
  label,
  render,
}: {
  label: string
  render: Renderable | JSX.Element
}): JSX.Element {
  // @ts-expect-error React descriptors are replaced by Vidact's compiled renderable capability.
  return React.cloneElement(
    // @ts-expect-error The render prop is a Vidact capability after compilation.
    render,
    null,
    <span data-cloned-child>{label}</span>,
  )
}

export function CloneElementChildrenApp(): JSX.Element {
  const [label, setLabel] = useState('First')

  return (
    <main data-clone-element-app>
      <button data-update-cloned-child onClick={() => setLabel('Second')}>
        Update
      </button>
      <ChildSlot label={label} render={<section data-cloned-target>Authored</section>} />
      <p data-stable-clone-sibling>Stable</p>
    </main>
  )
}
