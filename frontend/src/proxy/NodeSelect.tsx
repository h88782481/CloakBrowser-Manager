import type { Catalog } from "./api";

export function NodeSelect({ data, value, onChange, forSubscription = false, disabled }: {
  data: Catalog | null; value: string; onChange: (id: string) => void;
  forSubscription?: boolean; disabled?: boolean;
}) {
  const sources = new Map(data?.subscriptions.map((s) => [s.id, s.name]));
  return (
    <select className="input" aria-label={forSubscription ? "Fetch through" : "Proxy node"}
      value={value} disabled={!data || disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{forSubscription ? "Direct connection" : "No proxy node"}</option>
      {value && !data?.nodes.some((n) => n.id === value) && <option value={value} disabled>{data ? "Unavailable node" : "Loading..."}</option>}
      {data?.nodes.map((n) => <option key={n.id} value={n.id}>
        {n.name} · {n.source_id ? sources.get(n.source_id) : "Standalone node"}
      </option>)}
    </select>
  );
}
