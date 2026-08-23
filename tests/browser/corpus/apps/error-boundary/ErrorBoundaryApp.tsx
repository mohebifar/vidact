import { errorBoundary } from '@vidact/runtime'
import { useEffect, useState } from 'react'

const caught: string[] = []

export function readCaughtErrors(): readonly string[] {
  return caught
}

export function resetCaughtErrors(): void {
  caught.length = 0
}

function renderValue(value: string): string {
  if (value === 'render') throw new Error('render failed')
  return value
}

function FailingChild({ value }: { readonly value: string }): JSX.Element {
  useEffect(() => {
    if (value === 'effect') throw new Error('effect failed')
  }, [value])

  return (
    <button
      data-child
      onClick={() => {
        if (value === 'event') throw new Error('event failed')
      }}
    >
      {renderValue(value)}
    </button>
  )
}

function FailureBoundary({
  value,
  setValue,
}: {
  readonly value: string
  readonly setValue: (value: string) => void
}): JSX.Element {
  return errorBoundary(
    () => <FailingChild value={value} />,
    (error, reset) => (
      <section data-fallback>
        <output>{(error as Error).message}</output>
        <button
          data-reset
          onClick={() => {
            setValue('ready')
            reset()
          }}
        >
          Reset
        </button>
      </section>
    ),
    (error) => caught.push((error as Error).message),
  )
}

export default function ErrorBoundaryApp(): JSX.Element {
  const [value, setValue] = useState('ready')

  return (
    <main>
      <nav>
        <button data-render onClick={() => setValue('render')}>
          Render failure
        </button>
        <button data-event onClick={() => setValue('event')}>
          Event failure
        </button>
        <button data-effect onClick={() => setValue('effect')}>
          Effect failure
        </button>
      </nav>
      <FailureBoundary value={value} setValue={setValue} />
    </main>
  )
}
