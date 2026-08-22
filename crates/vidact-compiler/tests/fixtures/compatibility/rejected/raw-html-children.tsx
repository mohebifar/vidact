export function RawHtmlChildren(): Node {
  return (
    <section dangerouslySetInnerHTML={{ __html: '<strong>raw</strong>' }}>
      owned child
    </section>
  )
}
