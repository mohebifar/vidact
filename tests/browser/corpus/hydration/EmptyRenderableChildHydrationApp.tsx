import type { VidactNode } from '@vidact/react-types'
import { ArrowRightIcon } from 'lucide-react'

function Frame({ children }: { readonly children: VidactNode }) {
  return <section>{children}</section>
}

export function EmptyRenderableChildHydrationApp() {
  return (
    <Frame>
      Icon <ArrowRightIcon className="size-4" data-optional-children="" />
    </Frame>
  )
}
