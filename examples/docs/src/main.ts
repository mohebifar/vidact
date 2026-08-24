import { mountCompiled, mountHotRoot } from '@vidact/runtime'

import { App } from './App.tsx'

import './style.css'

const host = document.querySelector<HTMLElement>('#app')
if (host === null) throw new Error('Vidact docs host element is missing')

if (import.meta.hot === undefined) {
  mountCompiled(App, host)
} else {
  import.meta.hot.accept()
  mountHotRoot(import.meta.hot, host, App)
}
