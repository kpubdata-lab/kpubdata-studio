/**
 * Deliberately broken: the lint gate test (lintHooksGate.test.ts) expects ESLint to
 * reject every function here. eslint.config.mjs ignores this directory, so `npm run
 * lint` stays green; the test lints it with --no-ignore.
 */
import { useEffect, useState } from "react";

async function load(): Promise<string> {
  return "loaded";
}

export function ConditionalHook({ show }: { show: boolean }) {
  if (show) {
    const [value] = useState(0);
    return <p>{value}</p>;
  }
  return null;
}

export function MissingDependency({ id }: { id: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(id);
  }, []);
  return <p>{label}</p>;
}

export function FloatingPromise() {
  return <button onClick={() => { load(); }}>load</button>;
}
