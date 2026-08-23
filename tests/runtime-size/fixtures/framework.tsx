import { preconnect, preload } from 'react-dom'

export function FrameworkFixture(): JSX.Element {
  preconnect('https://cdn.example.test')
  preload('/app.css', { as: 'style' })
  return (
    <>
      <title>Framework fixture</title>
      <meta name="description" content="framework" />
      <main>framework</main>
    </>
  )
}
