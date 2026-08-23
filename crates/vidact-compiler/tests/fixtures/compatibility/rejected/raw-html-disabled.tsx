export function RawHtmlDisabled() {
  return <section dangerouslySetInnerHTML={{ __html: '<strong>raw</strong>' }} />
}
