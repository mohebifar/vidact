import { mountCompiled, type CompiledComponentResult } from '@vidact/runtime'

import { App } from './App.tsx'
import './shadcn-corpus.ts'

import './style.css'

const host = document.querySelector<HTMLElement>('#app')
if (host === null) throw new Error('Missing docs application root.')

mountCompiled(App as unknown as () => CompiledComponentResult, host)
