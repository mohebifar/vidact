import { useState } from "react";

export function AliasCounter() {
  const [count, setCount] = useState(1);
  const direct = count;
  const alias = direct;
  const doubled = alias * 2;

  return (
    <button data-count={alias} onClick={() => setCount((previous) => previous + 1)}>
      {doubled}
    </button>
  );
}
