import { Button } from '@base-ui/react/button'
import type { VidactNode } from '@vidact/react-types'
import { useState } from 'react'

type ButtonProps = Omit<Button.Props, 'children' | 'render'> & {
  readonly children?: VidactNode
  readonly render?: Button.Props['render'] | JSX.Element
}

const BaseButton = Button as unknown as (props: ButtonProps) => JSX.Element

export function BaseUiDependencyApp(): JSX.Element {
  const [count, setCount] = useState(0)

  return (
    <main data-base-ui-dependency>
      <BaseButton
        data-base-counter
        className="counter"
        onClick={() => setCount((value) => value + 1)}
      >
        Count {count}
      </BaseButton>
      <BaseButton
        render={<a data-base-link href="#details" />}
        nativeButton={false}
        onClick={(event) => event.preventDefault()}
      >
        Details
      </BaseButton>
    </main>
  )
}
