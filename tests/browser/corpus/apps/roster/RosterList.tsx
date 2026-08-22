import type { ReactNode } from 'react'

interface RosterListProps {
  readonly count: number
  readonly rows: ReactNode
}

export function RosterList({ count, rows }: RosterListProps): Node {
  return (
    <ul className="roster" data-member-count={count}>
      {rows}
    </ul>
  )
}
