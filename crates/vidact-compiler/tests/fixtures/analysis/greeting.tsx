export function Greeting({ name }: { name: string }) {
  const message = `Hello, ${name}`;

  return <p title={message}>{message}</p>;
}
