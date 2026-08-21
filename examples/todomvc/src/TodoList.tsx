import type { DirectChild } from '@vidact/runtime'

interface TodoListProps {
  readonly rows: DirectChild
}

export function TodoList({ rows }: TodoListProps): Node {
  return <ul className="todo-list">{rows}</ul>
}
