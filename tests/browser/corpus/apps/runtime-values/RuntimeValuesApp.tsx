export function ObjectChildApp(): JSX.Element {
  return <section>{{ type: 'foreign-element' } as any}</section>
}

export function FunctionChildApp(): JSX.Element {
  return <section>{(() => 'invalid') as any}</section>
}

export function SymbolChildApp(): JSX.Element {
  return <section>{Symbol('invalid') as any}</section>
}

export function PromiseChildApp(): JSX.Element {
  return <section>{Promise.resolve('invalid') as any}</section>
}
