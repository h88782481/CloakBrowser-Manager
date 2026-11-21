import { useEffect, useRef, useState } from "react";
import { poolApi, type ProxyKind } from "./api";

interface Props {
  kind: ProxyKind;
  ids: string[];
  pending: string | null;
  clear: () => void;
  run: (action: () => Promise<unknown>, operation: string) => Promise<boolean>;
}

export function BulkActions({ kind, ids, pending, clear, run }: Props) {
  const stop = useRef(false);
  const [done, setDone] = useState(0);
  useEffect(() => () => { stop.current = true; }, []);

  const check = () => run(async () => {
    stop.current = false;
    setDone(0);
    let completed = 0;
    let failed = 0;
    const queue = ids.values();
    async function worker() {
      for (const id of queue) {
        if (stop.current) break;
        try {
          const result = await poolApi.latency(kind, id);
          if (result.latency_ms === null) failed++;
        } catch { failed++; }
        setDone(++completed);
      }
    }
    // Each node check can own a native process. Keep a small number in flight.
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    return `Checked ${completed} of ${ids.length}: ${completed - failed} succeeded, ${failed} failed`;
  }, "bulk-check");

  const remove = async () => {
    if (!window.confirm(`Delete ${ids.length} selected items from the pool?`)) return;
    const ok = await run(async () => {
      const result = await poolApi.removeMany(kind, ids);
      return `Deleted ${result.count} items`;
    }, "bulk-delete");
    if (ok) clear();
  };

  return <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface-1 p-3 text-xs">
    <span>{`Selected: ${ids.length}`}</span>
    <button type="button" disabled={!!pending} className="btn-secondary" onClick={check}>Check selected latency</button>
    <button type="button" disabled={!!pending} className="btn-danger" onClick={remove}>Delete selected</button>
    <button type="button" disabled={!!pending} className="text-zinc-400 hover:underline" onClick={clear}>Clear selection</button>
    {pending === "bulk-check" && <>
      <span role="status">{`Checked ${done} / ${ids.length}`}</span>
      <button type="button" className="btn-secondary" onClick={() => { stop.current = true; }}>Stop after current checks</button>
    </>}
  </div>;
}
