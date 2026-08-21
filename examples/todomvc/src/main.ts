import { mount } from '@vidact/runtime'
import { TodoApp } from './TodoApp.tsx'
import './style.css'

const host = document.querySelector<HTMLElement>('#app')
if (host === null) throw new Error('TodoMVC host element is missing')

mount(TodoApp, host)
