export function RestProps({ title, ...rest }) {
  return <section {...rest}>{title}</section>
}
