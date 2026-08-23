import { preconnect } from 'react-dom'

export function FrameworkHintDisabled(): JSX.Element {
  preconnect('https://cdn.example.test')
  return <main>framework</main>
}
