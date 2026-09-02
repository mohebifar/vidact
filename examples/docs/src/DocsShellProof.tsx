import { useState } from 'react'

import { DocsLayout } from './components/docs-layout.tsx'
import { DocsPage } from './components/docs-page.tsx'
import { Button } from './components/ui/button.tsx'
import { Switch } from './components/ui/switch.tsx'
import { CounterDemo, HeroLogo, PlaylistDemo } from './routes/index.tsx'

export function SwitchProof() {
  return <Switch label="Compiled output" />
}

export function DocsLayoutProof() {
  return (
    <DocsLayout
      navigation={[
        {
          title: 'Getting started',
          items: [{ group: 'Getting started', title: 'Introduction', url: '/docs' }],
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
        group: 'Getting started',
        next: null,
        previous: null,
        sections: [
          {
            id: '',
            title: '',
            blocks: [
              {
                key: 'intro',
                type: 'paragraph',
                content: [
                  { key: 'intro-0', type: 'text', value: 'Call ' },
                  { key: 'intro-1', type: 'code', value: 'mountCompiled' },
                  { key: 'intro-2', type: 'text', value: ' from ' },
                  {
                    key: 'intro-3',
                    type: 'link',
                    href: '/docs/reference/runtime',
                    children: [{ key: 'intro-3-0', type: 'text', value: 'the runtime' }],
                  },
                  {
                    key: 'intro-4',
                    type: 'strong',
                    children: [{ key: 'intro-4-0', type: 'text', value: ' once' }],
                  },
                ],
              },
            ],
          },
          {
            id: 'proof',
            title: 'Interactive proof',
            blocks: [
              { key: 'counter', type: 'preview', variant: 'counter' },
              { key: 'heading', type: 'heading', id: 'steps', text: 'Steps' },
              {
                key: 'steps',
                type: 'list',
                ordered: true,
                items: [
                  {
                    key: 'steps-0',
                    content: [{ key: 'steps-0-0', type: 'text', value: 'Compile' }],
                  },
                  { key: 'steps-1', content: [{ key: 'steps-1-0', type: 'text', value: 'Mount' }] },
                ],
              },
              {
                key: 'bullets',
                type: 'list',
                ordered: false,
                items: [
                  { key: 'b-0', content: [{ key: 'b-0-0', type: 'code', value: 'useState' }] },
                ],
              },
              {
                key: 'callout',
                type: 'callout',
                tone: 'tip',
                title: 'Tip',
                paragraphs: [
                  { key: 'c-0', content: [{ key: 'c-0-0', type: 'text', value: 'Callout body' }] },
                ],
              },
              {
                key: 'table',
                type: 'table',
                headers: [{ key: 'h-0', content: [{ key: 'h-0-0', type: 'text', value: 'API' }] }],
                rows: [
                  {
                    key: 'r-0',
                    cells: [
                      {
                        key: 'r-0-0',
                        content: [{ key: 'r-0-0-0', type: 'code', value: 'useRef' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        title: 'Introduction',
        url: '/docs',
      }}
    />
  )
}

export function ButtonProof() {
  const [pressed, setPressed] = useState(false)
  return <Button onClick={() => setPressed(!pressed)}>{pressed ? 'Pressed' : 'Press me'}</Button>
}

export function LandingCounterProof() {
  return <CounterDemo />
}

export function LandingPlaylistProof() {
  return <PlaylistDemo />
}

export function LandingHeroLogoProof() {
  return <HeroLogo />
}
