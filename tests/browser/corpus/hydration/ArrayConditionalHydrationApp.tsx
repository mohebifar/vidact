function Arrow() {
  return <i data-array-arrow="">→</i>
}

function Wrapper({ children }: { readonly children: JSX.Element }) {
  return <a href="/next">{children}</a>
}

export function ArrayConditionalHydrationApp({
  direction,
}: {
  readonly direction: 'next' | 'previous'
}) {
  return (
    <Wrapper>
      <span data-array-conditional="">
        {direction === 'previous' ? <Arrow /> : null}
        Title
        {direction === 'next' ? <Arrow /> : null}
      </span>
    </Wrapper>
  )
}
