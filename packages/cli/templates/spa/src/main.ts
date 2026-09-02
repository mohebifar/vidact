import { mountCompiled } from '@vidact/runtime'

import { App } from './App.tsx'

import './style.css'

const host = document.querySelector<HTMLElement>('#app')
if (host === null) throw new Error('the #app host element is missing')

mountCompiled(App, host)
