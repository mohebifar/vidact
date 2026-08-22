import type { DirectChild } from '@vidact/runtime'

interface TodoListProps {
  readonly rows: DirectChild
  readonly visibleCount: number
}

export function TodoList({ rows, visibleCount }: TodoListProps): Node {
  return (
    <ul className="todo-list" data-visible-count={visibleCount}>
      {rows}
    </ul>
  )
}
