import type { VidactNode } from '@vidact/react-types'

function Panel({ children }: { readonly children?: VidactNode }) {
  return <div data-conditional-panel="">{children}</div>
}

function VisibleBranch() {
  return <p data-visible-branch="">Visible</p>
}

function AlternateBranch() {
  return <p data-alternate-branch="">Alternate</p>
}

export function ForwardedConditionalHydrationApp({
  mode,
}: {
  readonly mode: 'visible' | 'alternate' | 'empty'
}) {
  return (
    <Panel>
      {mode === 'visible' ? <VisibleBranch /> : mode === 'alternate' ? <AlternateBranch /> : null}
    </Panel>
  )
}
