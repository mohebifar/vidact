import { useState } from 'react'

export function RawHtml(): Node {
  const [html, setHtml] = useState('<strong>one</strong>')

  return (
    <main>
      <button onClick={() => setHtml('<em>two</em>')}>change</button>
      <section dangerouslySetInnerHTML={{ __html: html }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: '{"name":"Vidact"}' }}
      />
    </main>
  )
}
