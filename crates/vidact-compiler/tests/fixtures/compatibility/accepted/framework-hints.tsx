"use client"

import { preconnect, preload } from 'react-dom'

export function FrameworkHints(): JSX.Element {
  preconnect('https://cdn.example.test')
  preload('/app.css', { as: 'style' })
  return <main>framework</main>
}
