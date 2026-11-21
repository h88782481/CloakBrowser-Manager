import { useEffect, useRef, useState } from "react";
import { api, type ProxyTestResult } from "../lib/api";
import { POOL_OPEN, reference, selectionFrom } from "./api";
import { NodeSelect } from "./NodeSelect";
import { usePool } from "./usePool";

function CheckRoute({ value }: { value: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProxyTestResult | null>(null);
  const check = async () => {
    setBusy(true);
    setResult(null);
    try { setResult(await api.testProxy(value)); }
    catch (err) { setResult({ ok: false, error: err instanceof Error ? err.message : "Proxy test failed" }); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={check}>{busy ? "Checking..." : "Test connection"}</button>
    {result && <span role="status" className={result.ok ? "text-emerald-400" : "text-red-400"}>
      {result.ok ? [result.ip, result.country, result.latency_ms != null && `${result.latency_ms}ms`].filter(Boolean).join(" · ") : result.error}
    </span>}
  </>;
}

export function ProfileProxyField({ value, onChange }: { value: string; onChange: (next: string | null) => void }) {
  const { data, error, reload, revision } = usePool();
  const selected = selectionFrom(value);
  const home = selected?.home ?? "";
  const node = selected?.node ?? "";
  const missingHome = !!home && !data?.homes.some((item) => item.id === home);
  const missingNode = !!node && !data?.nodes.some((item) => item.id === node);
  const invalid = !selected || (!!data && (missingHome || missingNode));
  const homeSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    homeSelect.current?.setCustomValidity(invalid ? "Choose a new pool entry for this profile." : "");
  }, [invalid]);
  const summary = home && node ? "Browser → node → residential proxy" : home ? "Residential proxy only" : node ? "Proxy node only" : "Direct connection";

  return <fieldset aria-label="Proxy" className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">
      <label><span className="label">Static residential proxy</span>
        <select ref={homeSelect} className="input" value={home} disabled={!data} onChange={(e) => onChange(reference({ home: e.target.value, node }))}>
          <option value="">No residential proxy</option>
          {missingHome && <option value={home} disabled>{data ? "Unavailable residential proxy" : "Loading..."}</option>}
          {data?.homes.map((item) => <option key={item.id} value={item.id}>{item.name}{item.group_name && ` · ${item.group_name}`}</option>)}
        </select>
      </label>
      <label><span className="label">Proxy node</span>
        <NodeSelect data={data} value={node} onChange={(id) => onChange(reference({ home, node: id }))} />
      </label>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {invalid ? <><span role="alert" className="text-amber-400">Choose a new pool entry for this profile.</span>
        <button type="button" className="underline" onClick={() => onChange(null)}>Clear selection</button></> : <span className="text-zinc-400">{summary}</span>}
      {value && data && !invalid && <CheckRoute key={`${value}:${revision}`} value={value} />}
      <button type="button" className="text-accent hover:underline" onClick={() => window.dispatchEvent(new Event(POOL_OPEN))}>Manage proxy pool</button>
    </div>
    {error && <p role="alert" className="text-xs text-amber-400">{error} <button type="button" className="underline" onClick={reload}>Retry</button></p>}
  </fieldset>;
}
