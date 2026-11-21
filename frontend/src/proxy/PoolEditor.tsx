import { useEffect, useState, type FormEvent } from "react";
import { poolApi, type EditFields, type Editor, type Scheme } from "./api";

interface Props {
  editor: Editor; busy: boolean; onSave: (action: () => Promise<unknown>) => Promise<boolean>; onClose: () => void;
}

export function PoolEditor(props: Props) {
  const { kind, item } = props.editor;
  const id = item?.id;
  const [fields, setFields] = useState<EditFields | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setError("");
    poolApi.editDetails(kind, id, controller.signal).then((saved) => {
      if (!controller.signal.aborted) setFields(saved);
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load the proxy pool");
    });
    return () => controller.abort();
  }, [kind, id, attempt]);

  if (id && !fields) return <div className="flex items-center gap-3 text-sm">
    {error ? <><span role="alert" className="text-red-400">{error}</span>
      <button type="button" className="btn-secondary" onClick={() => setAttempt((n) => n + 1)}>Retry</button></>
      : <span role="status">Loading...</span>}
    <button type="button" className="btn-secondary" onClick={props.onClose}>Cancel</button>
  </div>;
  return <EditorForm {...props} fields={fields} />;
}

function EditorForm({ editor, busy, onSave, onClose, fields }: Props & { fields: EditFields | null }) {
  const { kind, item } = editor;
  const [name, setName] = useState(fields?.name ?? "");
  const [address, setAddress] = useState(fields?.address ?? "");
  const [group, setGroup] = useState(fields?.group_name ?? "");
  const [scheme, setScheme] = useState<Scheme>(fields?.scheme ?? "socks5");
  const [hidden, setHidden] = useState(false);
  const importing = kind === "homes" && !item;
  const adapter = kind === "nodes" && address.trimStart().startsWith("{");
  const addressLabel = kind === "homes" ? "Residential proxy addresses" : kind === "subscriptions" ? "Subscription URL"
    : adapter ? "Node configuration (JSON)" : "Node share link";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await onSave(() => {
      if (kind === "homes") return item ? poolApi.editHome(item.id, name, group, address, scheme) : poolApi.importHomes(address, group, scheme, name);
      if (kind === "nodes") return poolApi.saveNode(item?.id, name, address);
      return poolApi.saveSubscription(item?.id, name, address);
    });
    if (ok) onClose();
  };

  return <form onSubmit={submit} className="rounded-lg border border-border bg-surface-1 p-4">
    <fieldset disabled={busy} className="space-y-3">
      <label className="block"><span className="label">Display name</span>
        <input className="input" value={name} maxLength={200} required={(!importing && kind !== "nodes") || adapter}
          placeholder={importing ? "Optional; used as a prefix for multiple addresses" : undefined} onChange={(e) => setName(e.target.value)} />
      </label>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor="pool-edit-address" className="label">{addressLabel}</label>
          {!importing && <button type="button" className="text-xs text-zinc-400 hover:underline" onClick={() => setHidden(!hidden)}>
            {hidden ? "Show value" : "Hide value"}
          </button>}
        </div>
        {importing || (adapter && !hidden) ? <textarea id="pool-edit-address" className="input font-mono" rows={adapter ? 6 : 3}
          value={address} required spellCheck={false} autoComplete="off"
          placeholder={importing ? "One address per line. Append #name for a display name." : undefined} onChange={(e) => setAddress(e.target.value)} /> :
          <input id="pool-edit-address" className="input font-mono" type={hidden ? "password" : "text"} autoComplete="off" spellCheck={false} value={address} required
            onChange={(e) => setAddress(e.target.value)} />}
      </div>
      {editor.kind === "nodes" && editor.item?.source_id && <p className="text-xs text-zinc-400">The next successful sync replaces local changes to this node.</p>}
      {kind === "homes" && <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Group</span><input className="input" value={group} maxLength={100} onChange={(e) => setGroup(e.target.value)} /></label>
        <label><span className="label">Protocol for addresses without a scheme</span>
          <select className="input" value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)}>
            <option value="socks5">SOCKS5</option><option value="http">HTTP</option><option value="https">HTTPS</option>
          </select>
        </label>
      </div>}
      <div className="flex gap-2">
        <button className="btn-primary" type="submit">Save</button>
        <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}
