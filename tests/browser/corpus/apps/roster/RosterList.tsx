import type { VidactNode } from '@vidact/react-types'

interface RosterListProps {
  readonly count: number
  readonly rows: VidactNode
}

export function RosterList({ count, rows }: RosterListProps): JSX.Element {
  return (
    <ul className="roster" data-member-count={count}>
      {rows}
    </ul>
  )
}
