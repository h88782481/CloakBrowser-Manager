import { request } from "../lib/api";

export interface Item { id: string; name: string }
export interface Timing { latency_ms: number | null; error: string }
export interface Home extends Item, Timing { endpoint: string; group_name: string }
export interface PoolNode extends Item, Timing { protocol: string; source_id: string | null }
export interface Subscription extends Item { synced_at: string | null }
export interface Catalog {
  homes: Home[];
  nodes: PoolNode[];
  subscriptions: Subscription[];
  kernel_available: boolean;
  kernel_path: string;
}
export type Kind = "homes" | "nodes" | "subscriptions";
export type ProxyKind = Exclude<Kind, "subscriptions">;
export type Editor = { kind: "homes"; item?: Home } | { kind: "nodes"; item?: PoolNode } | { kind: "subscriptions"; item?: Subscription };
export type Scheme = "http" | "https" | "socks5";
export interface EditFields { name: string; address: string; group_name?: string; scheme?: Scheme }
export type Selection = { home: string; node: string };

export function selectionFrom(value: string): Selection | null {
  if (!value) return { home: "", node: "" };
  const match = /^pool:([0-9a-f]{32})?:([0-9a-f]{32})?$/.exec(value);
  return match && (match[1] || match[2]) ? { home: match[1] ?? "", node: match[2] ?? "" } : null;
}
export function reference({ home, node }: Selection): string | null {
  return home || node ? `pool:${home}:${node}` : null;
}

const root = "/api/proxy-pool";
export const POOL_OPEN = "cloak:pool-open";
export const POOL_CHANGED = "cloak:pool-changed";

function save<T>(path: string, body: unknown, method = "POST") {
  return request<T>(root + path, { method, body: JSON.stringify(body) });
}

export const poolApi = {
  catalog: (signal: AbortSignal) => request<Catalog>(root, { signal }),
  editDetails: (kind: Kind, id: string, signal: AbortSignal) =>
    request<EditFields>(`${root}/${kind}/${id}`, { signal, cache: "no-store" }),
  importHomes: (lines: string, group: string, scheme: Scheme, name: string) =>
    save<{ count: number }>("/homes", { lines, group, scheme, name }),
  editHome: (id: string, name: string, group: string, address: string | null, scheme: Scheme) =>
    save(`/homes/${id}`, { name, group, address, scheme }, "PUT"),
  saveNode: (id: string | undefined, name: string, link: string) =>
    save(id ? `/nodes/${id}` : "/nodes", { name, link }, id ? "PUT" : "POST"),
  saveSubscription: (id: string | undefined, name: string, url: string | null) =>
    save(id ? `/subscriptions/${id}` : "/subscriptions", { name, url }, id ? "PUT" : "POST"),
  sync: (id: string, node: string) => save<{ count: number }>(`/subscriptions/${id}/sync`, { node_id: node || null }),
  latency: (kind: ProxyKind, id: string) => save<Timing>(`/${kind}/${id}/latency`, {}),
  removeMany: (kind: ProxyKind, ids: string[]) => save<{ count: number }>(`/${kind}/bulk-delete`, { ids }),
  remove: (kind: Kind, id: string) => request(`${root}/${kind}/${id}`, { method: "DELETE" }),
  kernel: (path: string) => save("/kernel", { path }, "PUT"),
};
