export function PropsObject(props) {
  const key = 'title'
  return <section {...props}>{props.label}:{props[key]}</section>
}
