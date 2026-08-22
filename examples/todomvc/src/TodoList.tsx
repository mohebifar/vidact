import type { VidactNode } from '@vidact/react-types'

interface TodoListProps {
  readonly rows: VidactNode
  readonly visibleCount: number
}

export function TodoList({ rows, visibleCount }: TodoListProps): JSX.Element {
  return (
    <ul className="todo-list" data-visible-count={visibleCount}>
      {rows}
    </ul>
  )
}
