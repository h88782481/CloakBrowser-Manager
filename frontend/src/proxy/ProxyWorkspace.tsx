import { useEffect, useState } from "react";
import { translateText } from "../i18n/translate";
import { POOL_CHANGED, poolApi, type Editor, type Home, type Kind, type PoolNode, type Subscription, type Timing } from "./api";
import { NodeSelect } from "./NodeSelect";
import { BulkActions } from "./BulkActions";
import { PoolEditor } from "./PoolEditor";
import { usePool } from "./usePool";

const tabs: { kind: Kind; label: string; add: string }[] = [
  { kind: "homes", label: "Residential proxies", add: "Add residential proxies" },
  { kind: "nodes", label: "Proxy nodes", add: "Add standalone node" },
  { kind: "subscriptions", label: "Subscriptions", add: "Add subscription" },
];
type Row = { kind: "homes"; item: Home } | { kind: "nodes"; item: PoolNode } | { kind: "subscriptions"; item: Subscription };

function Delay({ item }: { item: Timing }) {
  if (item.error) return <span className="text-red-400" title={translateText(item.error)}>Check failed</span>;
  return <span>{item.latency_ms === null ? "Not checked" : `${item.latency_ms}ms`}</span>;
}

export function ProxyWorkspace({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = usePool();
  const [tab, setTab] = useState<Kind>("homes");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(40);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [via, setVia] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [kernelPath, setKernelPath] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const live = new Set(data[tab].map((item) => item.id));
    setEditor((current) => current?.item && current.kind === tab && !live.has(current.item.id) ? null : current);
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data, tab]);

  const select = (ids: string[], checked: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    return next;
  });

  const run = async (action: () => Promise<unknown>, operation = "save") => {
    setPending(operation);
    setNotice(null);
    try {
      const result = await action();
      setNotice(typeof result === "string" ? { text: result, failed: false } : null);
      window.dispatchEvent(new Event(POOL_CHANGED));
      return true;
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Operation failed", failed: true });
      return false;
    } finally { setPending(null); }
  };

  const changeTab = (kind: Kind) => {
    setTab(kind); setEditor(null); setQuery(""); setPage(1); setNotice(null); setSelected(new Set());
  };
  const subscriptions = new Map(data?.subscriptions.map((s) => [s.id, s.name]));
  const detail = (row: Row) => {
    if (row.kind === "homes") return [row.item.group_name, row.item.endpoint].filter(Boolean).join(" · ");
    if (row.kind === "nodes") return [row.item.source_id ? subscriptions.get(row.item.source_id) : "Standalone node", row.item.protocol].join(" · ");
    return row.item.synced_at ? new Date(row.item.synced_at).toLocaleString() : "Not synced";
  };
  const rows: Row[] = tab === "homes" ? (data?.homes ?? []).map((item) => ({ kind: "homes", item }))
    : tab === "nodes" ? (data?.nodes ?? []).map((item) => ({ kind: "nodes", item }))
    : (data?.subscriptions ?? []).map((item) => ({ kind: "subscriptions", item }));
  const search = query.trim().toLowerCase();
  const filtered = rows.filter((row) => `${row.item.name} ${detail(row)}`.toLowerCase().includes(search));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const offset = (current - 1) * pageSize;
  const end = Math.min(offset + pageSize, total);
  const pageRows = filtered.slice(offset, end);
  const pageIds = pageRows.map((row) => row.item.id);
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;

  return <div className="min-h-full space-y-4 bg-surface-0 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><button type="button" className="btn-secondary" onClick={onClose}>Back to profiles</button><h1 className="font-semibold">Proxy pool</h1></div>
      {data && <button type="button" className="btn-secondary text-xs" onClick={() => setKernelPath(kernelPath === null ? data.kernel_path : null)}>
        {data.kernel_available ? "mihomo settings" : "Configure mihomo"}
      </button>}
    </div>
    {kernelPath !== null && <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); if (await run(() => poolApi.kernel(kernelPath.trim()))) setKernelPath(null);
    }}>
      <label className="min-w-60 flex-1"><span className="label">mihomo executable path</span>
        <input className="input" value={kernelPath} onChange={(e) => setKernelPath(e.target.value)} placeholder="Leave blank to use bin/ or PATH" />
      </label><button disabled={busy} className="btn-primary" type="submit">Save</button>
    </form>}
    <nav className="flex flex-wrap gap-2 border-b border-border pb-3">
      {tabs.map((t) => <button type="button" key={t.kind} disabled={busy} aria-pressed={tab === t.kind} className={tab === t.kind ? "btn-primary" : "btn-secondary"}
        onClick={() => changeTab(t.kind)}>{t.label} <span className="opacity-70">{data?.[t.kind].length}</span></button>)}
    </nav>
    {error && <p role="alert" className="text-sm text-amber-400">{error} <button type="button" className="underline" onClick={reload}>Retry</button></p>}
    {notice && <p role="status" className={notice.failed ? "text-sm text-red-400" : "text-sm text-zinc-300"}>{notice.text}</p>}
    {data ? <>
      <div className="flex flex-wrap justify-between gap-2">
        <input className="input max-w-sm" value={query} disabled={busy} aria-label="Search pool" placeholder="Search pool"
          onChange={(e) => { setQuery(e.target.value); setPage(1); setSelected(new Set()); }} />
        <button type="button" disabled={busy} className="btn-primary" onClick={() => setEditor({ kind: tab })}>{tabs.find((t) => t.kind === tab)?.add}</button>
      </div>
      {editor && <PoolEditor key={`${editor.kind}:${editor.item?.id ?? "new"}`} editor={editor} busy={busy} onSave={run} onClose={() => setEditor(null)} />}
      {tab !== "subscriptions" && selected.size > 0 && <BulkActions kind={tab} ids={[...selected]} pending={pending} run={run}
        clear={() => setSelected(new Set())} />}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-2 text-xs text-gray-400"><tr>
            {tab !== "subscriptions" && <th className="w-10 p-3"><input type="checkbox" aria-label="Select this page"
              disabled={busy || !pageIds.length} checked={pageIds.length > 0 && pageSelected === pageIds.length}
              ref={(el) => { if (el) el.indeterminate = pageSelected > 0 && pageSelected < pageIds.length; }}
              onChange={(e) => select(pageIds, e.target.checked)} /></th>}
            <th className="p-3">Display name</th><th className="p-3">{tab === "subscriptions" ? "Last sync" : tab === "homes" ? "Group and endpoint" : "Source and protocol"}</th>
            <th className="p-3">{tab === "subscriptions" ? "Fetch through" : "Latency"}</th><th className="p-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {pageRows.map((row) => <tr key={row.item.id} className={selected.has(row.item.id) ? "bg-accent/10" : undefined}>
              {row.kind !== "subscriptions" && <td className="p-3"><input type="checkbox" aria-label={`Select ${row.item.name}`}
                disabled={busy} checked={selected.has(row.item.id)} onChange={(e) => select([row.item.id], e.target.checked)} /></td>}
              <td className="p-3 font-medium">{row.item.name}</td><td className="p-3 text-xs text-gray-400">{detail(row)}</td>
              <td className="p-3">{row.kind === "subscriptions" ?
                <NodeSelect forSubscription data={data} value={via[row.item.id] ?? ""} disabled={busy}
                  onChange={(id) => setVia((prev) => ({ ...prev, [row.item.id]: id }))} /> : <Delay item={row.item} />}</td>
              <td className="p-3"><fieldset disabled={busy} className="flex flex-wrap gap-2 text-xs">
                {row.kind === "subscriptions" ? <button type="button" className="btn-secondary" onClick={() => void run(async () => {
                  const result = await poolApi.sync(row.item.id, via[row.item.id] ?? ""); return `Synced ${result.count} nodes`;
                }, row.item.id)}>{pending === row.item.id ? "Syncing..." : "Sync subscription"}</button> :
                  <button type="button" className="btn-secondary" onClick={() => void run(() => poolApi.latency(row.kind, row.item.id), row.item.id)}>
                    {pending === row.item.id ? "Checking..." : "Check latency"}
                  </button>}
                <button type="button" className="btn-secondary" onClick={() => setEditor(row)}>Edit</button>
                <button type="button" className="btn-danger" onClick={() => {
                  if (window.confirm(`Delete ${row.item.name} from the pool?`)) void run(() => poolApi.remove(row.kind, row.item.id));
                }}>Delete</button>
              </fieldset></td>
            </tr>)}
            {!filtered.length && <tr><td className="p-6 text-center text-gray-400" colSpan={tab === "subscriptions" ? 4 : 5}>No pool entries to show.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span aria-live="polite" className="text-gray-400">
          {total ? `Showing ${offset + 1}–${end} of ${total}` : "0 entries"}
          {search && ` (${rows.length} before filtering)`}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="pool-page-size">Rows per page</label>
          <select id="pool-page-size" className="input h-8 w-auto py-1 text-xs" value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {[10, 20, 40, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <button type="button" className="btn-secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous page</button>
          <span className="tabular-nums">{current} / {pages}</span>
          <button type="button" className="btn-secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>Next page</button>
        </div>
      </div>
    </> : !error && <p role="status">Loading...</p>}
  </div>;
}
