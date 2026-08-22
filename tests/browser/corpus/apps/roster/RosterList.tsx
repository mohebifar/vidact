import type { ReactNode } from 'react'

interface RosterListProps {
  readonly count: number
  readonly rows: ReactNode
}

export function RosterList({ count, rows }: RosterListProps): JSX.Element {
  return (
    <ul className="roster" data-member-count={count}>
      {rows}
    </ul>
  )
}
