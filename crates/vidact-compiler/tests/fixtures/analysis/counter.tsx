import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  const doubled = count * 2;

  return <button onClick={() => setCount(count + 1)}>{doubled}</button>;
}
