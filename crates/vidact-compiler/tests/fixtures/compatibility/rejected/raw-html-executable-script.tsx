export function ExecutableRawScript(): Node {
  return (
    <script dangerouslySetInnerHTML={{ __html: 'globalThis.compromised = true' }} />
  )
}
