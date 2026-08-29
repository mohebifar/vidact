import { mountCompiled } from '@vidact/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import { TodoApp } from './TodoApp.tsx'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('Vidact TodoMVC', () => {
  it('adds, toggles, filters, edits, removes, and clears array items', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    dispose = mountCompiled(TodoApp, host).dispose

    addTodo(host, 'Study React Compiler')
    expect(host.querySelector<HTMLInputElement>('.new-todo')?.value).toBe('')
    addTodo(host, 'Ship direct DOM')
    expect(labels(host)).toEqual(['Study React Compiler', 'Ship direct DOM'])
    expect(host.querySelector('.todo-list')?.getAttribute('data-visible-count')).toBe('2')
    expect(host.querySelector('.todo-count')?.textContent).toContain('2 items left')

    const rootBeforeToggle = host.firstChild
    const affectedTodoBeforeToggle = host.querySelectorAll('li')[0]
    const unaffectedTodoBeforeToggle = host.querySelectorAll('li')[1]
    const draftInput = host.querySelector<HTMLInputElement>('.new-todo')
    if (draftInput !== null) draftInput.value = 'Keep this draft'
    host.querySelector<HTMLInputElement>('.toggle')?.click()
    expect(host.firstChild).toBe(rootBeforeToggle)
    expect(host.querySelectorAll('li')[0]).toBe(affectedTodoBeforeToggle)
    expect(host.querySelectorAll('li')[1]).toBe(unaffectedTodoBeforeToggle)
    expect(host.querySelector<HTMLInputElement>('.new-todo')?.value).toBe('Keep this draft')
    expect(host.querySelectorAll('.completed')).toHaveLength(1)
    expect(host.querySelector('.todo-count')?.textContent).toContain('1 item left')

    host.querySelector<HTMLButtonElement>('[data-filter="active"]')?.click()
    expect(labels(host)).toEqual(['Ship direct DOM'])
    expect(host.querySelector('.todo-list')?.getAttribute('data-visible-count')).toBe('1')
    host.querySelector<HTMLButtonElement>('[data-filter="completed"]')?.click()
    expect(labels(host)).toEqual(['Study React Compiler'])
    expect(host.querySelector('.todo-list')?.getAttribute('data-visible-count')).toBe('1')

    const editedRow = host.querySelector<HTMLElement>('.todo-list li')!
    const editedLabel = editedRow.querySelector<HTMLLabelElement>('label')!
    await userEvent.dblClick(editedLabel)
    const edit = host.querySelector<HTMLInputElement>('.edit')
    if (edit === null) throw new Error('Expected the edit input to mount.')
    expect(document.activeElement).toBe(edit)
    await userEvent.clear(edit)
    await userEvent.type(edit, 'Understand React Compiler{Enter}')
    expect(host.querySelector('.todo-list li')).toBe(editedRow)
    expect(editedRow.querySelector('label')).toBe(editedLabel)
    expect(labels(host)).toEqual(['Understand React Compiler'])

    host.querySelector<HTMLButtonElement>('.clear-completed')?.click()
    host.querySelector<HTMLButtonElement>('[data-filter="all"]')?.click()
    expect(labels(host)).toEqual(['Ship direct DOM'])

    host.querySelector<HTMLButtonElement>('.destroy')?.click()
    expect(labels(host)).toEqual([])
  })
})

function addTodo(host: ParentNode, title: string): void {
  const input = host.querySelector<HTMLInputElement>('.new-todo')
  const form = host.querySelector<HTMLFormElement>('.todo-form')
  expect(input).not.toBeNull()
  expect(form).not.toBeNull()
  if (input === null || form === null) return
  input.value = title
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
}

function labels(host: ParentNode): string[] {
  return [...host.querySelectorAll('.todo-list label')].map((label) => label.textContent ?? '')
}
