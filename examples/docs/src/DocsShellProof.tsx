import { useState } from 'react'

import { DocsLayout } from './components/docs-layout.tsx'
import { DocsPage } from './components/docs-page.tsx'
import { Button } from './components/ui/button.tsx'
import { Switch } from './components/ui/switch.tsx'

export function SwitchProof() {
  return <Switch label="Compiled output" />
}

export function DocsLayoutProof() {
  return (
    <DocsLayout
      navigation={[
        {
          title: 'Overview',
          items: [{ group: 'Overview', title: 'Vidact documentation', url: '/docs' }],
        },
      ]}
      requestUrl="https://example.test/docs"
    >
      <article>Content</article>
    </DocsLayout>
  )
}

export function DocsPageProof() {
  return (
    <DocsPage
      page={{
        description: 'A compiled documentation page.',
        kind: 'Overview',
        next: null,
        previous: null,
        sections: [
          {
            id: 'proof',
            title: 'Interactive proof',
            blocks: [{ key: 'counter', type: 'preview', variant: 'counter' }],
          },
        ],
        title: 'Vidact documentation',
        url: '/docs',
      }}
    />
  )
}

export function ButtonProof() {
  const [pressed, setPressed] = useState(false)
  return <Button onClick={() => setPressed(!pressed)}>{pressed ? 'Pressed' : 'Press me'}</Button>
}
