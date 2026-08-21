import { useState } from "react";

type Todo = { id: string; label: string };

export function Todos() {
  const [items] = useState<Todo[]>([]);

  return <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
