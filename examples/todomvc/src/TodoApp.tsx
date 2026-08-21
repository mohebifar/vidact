import { useState } from 'react'
import { TodoList } from './TodoList.tsx'

interface Todo {
  readonly id: string
  readonly title: string
  readonly completed: boolean
}

type Filter = 'all' | 'active' | 'completed'

const FILTERS: readonly Filter[] = ['all', 'active', 'completed']

export function TodoApp(): Node {
  const [todos, setTodos] = useState<Todo[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const activeCount = todos.filter((todo) => !todo.completed).length
  const completedCount = todos.length - activeCount
  const visibleTodos = todos.filter((todo) => {
    if (filter === 'active') return !todo.completed
    if (filter === 'completed') return todo.completed
    return true
  })

  const addTodo = (event: SubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const input = form.elements.namedItem('title') as HTMLInputElement | null
    const title = input?.value.trim() ?? ''
    if (title === '') return
    setTodos((current) => [
      ...current,
      { id: crypto.randomUUID(), title, completed: false },
    ])
    if (input !== null) input.value = ''
    queueMicrotask(() => input?.focus())
  }

  const toggleTodo = (id: string): void => {
    setTodos((current) => current.map((todo) => (
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    )))
  }

  const removeTodo = (id: string): void => {
    setTodos((current) => current.filter((todo) => todo.id !== id))
  }

  const beginEdit = (id: string, label: HTMLLabelElement): void => {
    setEditingId(id)
    queueMicrotask(() => {
      const input = label.closest('li')?.querySelector<HTMLInputElement>('.edit')
      input?.focus()
      input?.select()
    })
  }

  const commitEdit = (id: string, value: string): void => {
    const title = value.trim()
    if (title === '') {
      removeTodo(id)
    } else {
      setTodos((current) => current.map((todo) => (
        todo.id === id ? { ...todo, title } : todo
      )))
    }
    setEditingId(null)
  }

  return (
    <section className="todoapp" data-vidact-example="todomvc">
      <header className="header">
        <h1>todos</h1>
        <form className="todo-form" onSubmit={addTodo}>
          <input
            className="new-todo"
            name="title"
            placeholder="What needs to be done?"
            aria-label="New todo title"
            autoFocus
          />
        </form>
      </header>

      {todos.length > 0 && (
        <main className="main">
          <input
            id="toggle-all"
            className="toggle-all"
            type="checkbox"
            checked={activeCount === 0}
            onChange={() => setTodos((current) => current.map((todo) => ({
              ...todo,
              completed: activeCount > 0,
            })))}
          />
          <label htmlFor="toggle-all">Mark all as complete</label>
          <TodoList
            rows={visibleTodos.map((todo) => (
              <li
                key={todo.id}
                className={`${todo.completed ? 'completed' : ''} ${editingId === todo.id ? 'editing' : ''}`.trim()}
                data-todo-id={todo.id}
              >
                <div className="view">
                  <input
                    className="toggle"
                    type="checkbox"
                    checked={todo.completed}
                    aria-label={`Toggle ${todo.title}`}
                    onChange={() => toggleTodo(todo.id)}
                  />
                  <label onDoubleClick={(event: MouseEvent) => beginEdit(
                    todo.id,
                    event.currentTarget as HTMLLabelElement,
                  )}>{todo.title}</label>
                  <button
                    className="destroy"
                    aria-label={`Delete ${todo.title}`}
                    onClick={() => removeTodo(todo.id)}
                  />
                </div>
                {editingId === todo.id && (
                  <input
                    className="edit"
                    value={todo.title}
                    aria-label={`Edit ${todo.title}`}
                    onBlur={(event: FocusEvent) => commitEdit(
                      todo.id,
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                    onKeyDown={(event: KeyboardEvent) => {
                      const input = event.currentTarget as HTMLInputElement
                      if (event.key === 'Enter') commitEdit(todo.id, input.value)
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                )}
              </li>
            ))}
          />
        </main>
      )}

      {todos.length > 0 && (
        <footer className="footer">
          <span className="todo-count">
            <strong>{activeCount}</strong> {activeCount === 1 ? 'item' : 'items'} left
          </span>
          <ul className="filters">
            {FILTERS.map((name) => (
              <li key={name}>
                <button
                  className={filter === name ? 'selected' : ''}
                  data-filter={name}
                  onClick={() => setFilter(name)}
                >
                  {name[0]?.toUpperCase()}{name.slice(1)}
                </button>
              </li>
            ))}
          </ul>
          {completedCount > 0 && (
            <button
              className="clear-completed"
              onClick={() => setTodos((current) => current.filter((todo) => !todo.completed))}
            >
              Clear completed
            </button>
          )}
        </footer>
      )}
    </section>
  )
}
