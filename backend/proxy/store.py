"""SQLite catalog for explicitly selected residential proxies, nodes and subscriptions."""

from __future__ import annotations

from contextlib import contextmanager
import sqlite3
from uuid import UUID, uuid4, uuid5

from .. import database as db
from .formats import HomeAddress, ImportedNode, PoolError, Selection, editable_node_text


def init() -> None:
    with db.get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS pool_homes (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT NOT NULL,
                url TEXT NOT NULL, endpoint TEXT NOT NULL, username TEXT NOT NULL,
                latency_ms INTEGER, error TEXT NOT NULL DEFAULT '', UNIQUE(endpoint, username)
            );
            CREATE TABLE IF NOT EXISTS pool_subscriptions (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0, synced_at TEXT
            );
            CREATE TABLE IF NOT EXISTS pool_nodes (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, payload TEXT NOT NULL,
                source_id TEXT REFERENCES pool_subscriptions(id) ON DELETE CASCADE,
                latency_ms INTEGER, error TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS pool_nodes_source ON pool_nodes(source_id);
            CREATE TABLE IF NOT EXISTS pool_kernel (id INTEGER PRIMARY KEY CHECK(id=1), path TEXT NOT NULL);
        """)


@contextmanager
def _write():
    with db.get_db() as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        yield conn


def catalog() -> dict:
    with db.get_db() as conn:
        def rows(sql: str) -> list[dict]:
            return [dict(row) for row in conn.execute(sql)]

        return {
            "homes": rows("SELECT id,name,group_name,endpoint,latency_ms,error FROM pool_homes ORDER BY name,id"),
            "nodes": rows("SELECT id,name,source_id,protocol,latency_ms,error FROM pool_nodes ORDER BY name,id"),
            "subscriptions": rows("SELECT id,name,synced_at FROM pool_subscriptions ORDER BY name,id"),
        }


def resolve(selection: Selection) -> tuple[str | None, str | None]:
    """Return the precise home URL and single-node provider payload or reject a stale selection."""
    with db.get_db() as conn:
        def get(sql: str, item_id: str) -> str | None:
            if not item_id:
                return None
            row = conn.execute(sql, (item_id,)).fetchone()
            if row is None:
                raise PoolError("Selected proxy is no longer in the pool", 409)
            return row[0]

        return (get("SELECT url FROM pool_homes WHERE id=?", selection.home),
                get("SELECT payload FROM pool_nodes WHERE id=?", selection.node))


def validate_reference(value: str | None) -> None:
    if value is not None:
        resolve(Selection.parse(value))


def _require_change(cursor: sqlite3.Cursor) -> None:
    if not cursor.rowcount:
        raise PoolError("Pool item not found", 404)


def edit_details(kind: str, item_id: str) -> dict:
    query = {
        "homes": "SELECT name,url AS address,group_name FROM pool_homes WHERE id=?",
        "nodes": "SELECT name,payload FROM pool_nodes WHERE id=?",
        "subscriptions": "SELECT name,url AS address FROM pool_subscriptions WHERE id=?",
    }[kind]
    with db.get_db() as conn:
        row = conn.execute(query, (item_id,)).fetchone()
    if row is None:
        raise PoolError("Pool item not found", 404)
    fields = dict(row)
    if kind == "nodes":
        fields["address"] = editable_node_text(fields.pop("payload"))
    elif kind == "homes":
        fields["scheme"] = fields["address"].partition("://")[0]
    return fields


def import_homes(text: str, scheme: str, group: str, name: str = "") -> int:
    lines = [(n, line.strip()) for n, line in enumerate(text.splitlines(), 1)
             if line.strip() and not line.lstrip().startswith("#")]
    if not lines:
        raise PoolError("Enter at least one residential proxy")
    with _write() as conn:
        for index, (number, line) in enumerate(lines, 1):
            address, _, label = line.partition("#")
            label = label.strip() or (f"{name} {index}" if name and len(lines) > 1 else name)
            try:
                home = HomeAddress.parse(address, scheme)
            except PoolError:
                raise PoolError(f"Invalid proxy address on line {number}") from None
            conn.execute("""
                INSERT INTO pool_homes(id,name,group_name,url,endpoint,username) VALUES (?,?,?,?,?,?)
                ON CONFLICT(endpoint,username) DO UPDATE SET url=excluded.url,
                    name=CASE WHEN ? != '' THEN excluded.name ELSE pool_homes.name END,
                    group_name=COALESCE(NULLIF(excluded.group_name,''),pool_homes.group_name),
                    latency_ms=CASE WHEN pool_homes.url=excluded.url THEN latency_ms END,
                    error=CASE WHEN pool_homes.url=excluded.url THEN error ELSE '' END
            """, (uuid4().hex, label or home.endpoint.split('://')[1], group, home.url,
                  home.endpoint, home.username, label))
    return len(lines)


def edit_home(item_id: str, name: str, group: str, address: str | None, scheme: str) -> None:
    with _write() as conn:
        _require_change(conn.execute("UPDATE pool_homes SET name=?,group_name=? WHERE id=?", (name, group, item_id)))
        if address is not None:
            home = HomeAddress.parse(address, scheme)
            try:
                conn.execute("UPDATE pool_homes SET url=?,endpoint=?,username=?,latency_ms=NULL,error='' WHERE id=? AND url!=?",
                             (home.url, home.endpoint, home.username, item_id, home.url))
            except sqlite3.IntegrityError:
                raise PoolError("This residential proxy already exists", 409) from None


def save_node(node: ImportedNode, item_id: str | None = None) -> None:
    with _write() as conn:
        if item_id is None:
            conn.execute("INSERT INTO pool_nodes(id,name,protocol,payload) VALUES (?,?,?,?)",
                         (uuid4().hex, node.name, node.protocol, node.payload))
        else:
            _require_change(conn.execute("""
                UPDATE pool_nodes SET name=?, protocol=?, payload=?,
                    latency_ms=CASE WHEN payload=? THEN latency_ms END,
                    error=CASE WHEN payload=? THEN error ELSE '' END
                WHERE id=?
            """, (node.name, node.protocol, node.payload, node.payload, node.payload, item_id)))


def save_subscription(name: str, url: str | None, item_id: str | None = None) -> str:
    with _write() as conn:
        if item_id is None:
            if not url:
                raise PoolError("Enter a subscription URL")
            item_id = uuid4().hex
            conn.execute("INSERT INTO pool_subscriptions(id,name,url) VALUES (?,?,?)", (item_id, name, url))
        else:
            _require_change(conn.execute("UPDATE pool_subscriptions SET name=?,url=COALESCE(?,url),revision=revision+1 "
                                         "WHERE id=?", (name, url, item_id)))
    return item_id


def subscription(item_id: str) -> dict:
    with db.get_db() as conn:
        row = conn.execute("SELECT id,url,revision FROM pool_subscriptions WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise PoolError("Subscription not found", 404)
        return dict(row)


def replace_subscription(source: dict, nodes: list[ImportedNode]) -> None:
    source_id = source['id']
    with _write() as conn:
        changed = conn.execute("UPDATE pool_subscriptions SET revision=revision+1,synced_at=? "
                               "WHERE id=? AND revision=?", (db._now(), source_id, source['revision']))
        if not changed.rowcount:
            raise PoolError("Subscription changed during sync; refresh and try again", 409)
        removed = {r[0] for r in conn.execute("SELECT id FROM pool_nodes WHERE source_id=?", (source_id,))}
        for node in nodes:
            # Identical labels in different subscriptions are independent identities.
            item_id = uuid5(UUID(source_id), node.name).hex
            removed.discard(item_id)
            conn.execute("""
                INSERT INTO pool_nodes(id,name,protocol,payload,source_id) VALUES (?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,protocol=excluded.protocol,payload=excluded.payload,
                    latency_ms=CASE WHEN pool_nodes.payload=excluded.payload THEN latency_ms END,
                    error=CASE WHEN pool_nodes.payload=excluded.payload THEN error ELSE '' END
                WHERE pool_nodes.name != excluded.name OR pool_nodes.payload != excluded.payload
            """, (item_id, node.name, node.protocol, node.payload, source_id))
        conn.executemany("DELETE FROM pool_nodes WHERE id=?", ((item_id,) for item_id in removed))


def delete_items(kind: str, item_ids: list[str]) -> int:
    ids = list(dict.fromkeys(item_ids))
    if not ids:
        raise PoolError("Select at least one item")
    table = {"homes": "pool_homes", "nodes": "pool_nodes", "subscriptions": "pool_subscriptions"}[kind]
    marks = ','.join('?' for _ in ids)
    with _write() as conn:
        if kind == "subscriptions":
            used = conn.execute("SELECT 1 FROM profiles p JOIN pool_nodes n ON p.proxy LIKE 'pool:%:' || n.id "
                                f"WHERE n.source_id IN ({marks}) LIMIT 1", ids).fetchone()
        else:
            # References are pool:<home id>:<node id>; either slot can be empty.
            slot = "substr(proxy,6,32)" if kind == "homes" else "substr(proxy,-32)"
            used = conn.execute(f"SELECT 1 FROM profiles WHERE proxy LIKE 'pool:%' AND {slot} IN ({marks}) LIMIT 1", ids).fetchone()
        if used:
            raise PoolError("Unlink this item from its profiles before deleting it", 409)
        count = conn.execute(f"DELETE FROM {table} WHERE id IN ({marks})", ids).rowcount
        if count != len(ids):
            raise PoolError("Pool item not found", 404)
        return count


def record_latency(selection: Selection, snapshot: str, latency: int | None, error: str) -> None:
    table, column, item_id = (('pool_homes', 'url', selection.home) if selection.home
                              else ('pool_nodes', 'payload', selection.node))
    with _write() as conn:
        changed = conn.execute(f"UPDATE {table} SET latency_ms=?,error=? WHERE id=? AND {column}=?",
                               (latency, error, item_id, snapshot))
        if not changed.rowcount:
            raise PoolError("Proxy changed during the latency check", 409)


def kernel_path() -> str:
    with db.get_db() as conn:
        row = conn.execute("SELECT path FROM pool_kernel WHERE id=1").fetchone()
        return row[0] if row else ""


def set_kernel_path(path: str) -> None:
    with _write() as conn:
        conn.execute("INSERT OR REPLACE INTO pool_kernel(id,path) VALUES(1,?)", (path,))
