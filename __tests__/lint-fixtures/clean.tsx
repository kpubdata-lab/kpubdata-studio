/**
 * The well-formed counterpart of hookViolations.tsx: the lint gate test expects
 * ESLint to accept it, so a rule that rejects everything cannot pass the test.
 */
import { useEffect, useState } from "react";

async function load(): Promise<string> {
  return "loaded";
}

export function Loader({ id }: { id: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    let active = true;
    load().then(
      (value) => {
        if (active) setLabel(`${id}:${value}`);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [id]);
  return <p>{label}</p>;
}
