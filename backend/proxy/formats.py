"""Pool references and import formats. Each node payload contains exactly one adapter."""

from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import json
import re
from urllib.parse import quote, unquote, urlsplit

import yaml


class PoolError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Selection:
    home: str = ""
    node: str = ""

    @classmethod
    def parse(cls, value: str | None) -> Selection:
        if value is None:
            return cls()
        match = re.fullmatch(r"pool:([a-f0-9]{32})?:([a-f0-9]{32})?", value)
        if not match or not any(match.groups()):
            raise PoolError("Select a residential proxy or a node from the pool")
        return cls(*match.groups(default=""))


@dataclass(frozen=True)
class HomeAddress:
    url: str
    endpoint: str
    username: str

    @classmethod
    def parse(cls, text: str, scheme: str) -> HomeAddress:
        raw = text.strip()
        if "://" not in raw:
            parts = re.fullmatch(r"(\[[^\]]+\]|[^:@]+):(\d+):([^:]*):(.*)", raw)
            if parts:
                host, port, user, password = parts.groups()
                raw = f"{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}"
            raw = f"{scheme}://{raw}"
        try:
            uri = urlsplit(raw)
            host, port = uri.hostname, uri.port
        except ValueError:
            raise PoolError("Invalid residential proxy address") from None
        if (uri.scheme not in {"http", "https", "socks5"} or not host or not port
                or any(ch.isspace() for ch in host) or uri.path not in ("", "/") or uri.query or uri.fragment):
            raise PoolError("Invalid residential proxy address")
        authority = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
        user = unquote(uri.username or "")
        auth = ""
        if uri.username is not None:
            auth = quote(user, safe="")
            if uri.password is not None:
                auth += ":" + quote(unquote(uri.password), safe="")
            auth += "@"
        return cls(f"{uri.scheme}://{auth}{authority}", f"{uri.scheme}://{authority}", user)


def endpoint_adapter(url: str) -> dict:
    uri = urlsplit(url)
    adapter = {"type": "socks5" if uri.scheme == "socks5" else "http", "server": uri.hostname, "port": uri.port}
    if uri.scheme == "https":
        adapter["tls"] = True
    if uri.username is not None:
        adapter["username"] = unquote(uri.username)
    if uri.password is not None:
        adapter["password"] = unquote(uri.password)
    return adapter


@dataclass(frozen=True)
class ImportedNode:
    name: str
    protocol: str
    payload: str


def editable_node_text(payload: str) -> str:
    """Return a share URL or a single Clash adapter, without the internal provider wrapper."""
    if not payload.startswith("{"):
        return base64.b64decode(payload, validate=True).decode("utf-8")
    adapter = json.loads(payload)["proxies"][0]
    del adapter["name"]  # The editor has a separate display name field.
    if adapter["type"] in {"http", "socks5"}:
        scheme = "https" if adapter.get("tls") else adapter["type"]
        host = str(adapter["server"])
        authority = f"[{host}]" if ":" in host else host
        auth = ""
        if "username" in adapter:
            auth = quote(str(adapter["username"]), safe="")
            if "password" in adapter:
                auth += ":" + quote(str(adapter["password"]), safe="")
            auth += "@"
        url = f"{scheme}://{auth}{authority}:{adapter.get('port', '')}"
        # Keep the full adapter if a URL would discard any protocol options.
        try:
            if endpoint_adapter(url) == adapter:
                return url
        except ValueError:
            pass
    return json.dumps(adapter, ensure_ascii=False, indent=2)


def node_from_editor(text: str, name: str) -> ImportedNode:
    if not text.lstrip().startswith("{"):
        return link_node(text, name)
    try:
        adapter = json.loads(text)
    except (ValueError, RecursionError):
        raise PoolError("Invalid node configuration JSON") from None
    if not isinstance(adapter, dict):
        raise PoolError("Invalid subscription node")
    return _adapter_node({**adapter, "name": name.strip() or adapter.get("name")})


_ENDPOINT_TYPES = {"http", "https", "socks5"}
_LINK_TYPES = _ENDPOINT_TYPES | {"vless", "vmess", "ss", "ssr", "trojan", "hy2", "hysteria2", "hysteria", "tuic", "wireguard", "anytls"}
_ADAPTER_TYPES = _LINK_TYPES | {"http", "socks5", "snell", "mieru", "ssh", "shadowtls"}
MAX_FEED_BYTES = 2 * 1024 * 1024


class _FeedLoader(yaml.SafeLoader):
    """Bound the expanded size before PyYAML constructs aliases or merge keys."""

    def __init__(self, stream):
        super().__init__(stream)
        self._sizes = {}

    def compose_node(self, parent, index):
        node = super().compose_node(parent, index)
        if isinstance(node, yaml.ScalarNode):
            size = 1 + len(node.value)
        else:
            children = (child for pair in node.value for child in pair) if isinstance(node, yaml.MappingNode) else node.value
            size = 1 + sum(self._sizes.get(child, MAX_FEED_BYTES * 4) for child in children)
        if size > MAX_FEED_BYTES * 4:
            raise PoolError("Invalid subscription size")
        self._sizes[node] = size
        return node


def _base64(text: str) -> bytes:
    compact = "".join(text.split()).encode("ascii")
    return base64.b64decode(compact + b"=" * (-len(compact) % 4), altchars=b"-_", validate=True)


def link_node(link: str, name: str = "") -> ImportedNode:
    link = link.strip()
    scheme, sep, content = link.partition("://")
    if not sep or scheme not in _LINK_TYPES or not content or len(link.splitlines()) != 1 or any(ch.isspace() for ch in link.split("#", 1)[0]):
        raise PoolError("Invalid node share link")
    name = name.strip() or unquote(link.partition("#")[2]).strip()
    if scheme in _ENDPOINT_TYPES:
        endpoint = HomeAddress.parse(link.partition("#")[0], scheme)
        return _adapter_node({"name": name or endpoint.endpoint, **endpoint_adapter(endpoint.url)})
    if not name and scheme == "vmess":
        try:
            name = str(json.loads(_base64(content))["ps"]).strip()
        except (ValueError, UnicodeError, KeyError, TypeError):
            pass  # The native provider also supports URL-form VMess links.
    if not name:
        name = f"{scheme} · {hashlib.sha256(link.encode()).hexdigest()[:10]}"
    payload = base64.b64encode(link.encode()).decode("ascii")
    return ImportedNode(name, scheme, payload)


def subscription_nodes(body: bytes) -> list[ImportedNode]:
    """Accept a share-link list, its base64 representation, or the proxies section of Clash YAML."""
    if not body or len(body) > MAX_FEED_BYTES:
        raise PoolError("Invalid subscription size")
    try:
        text = body.decode("utf-8-sig").strip()
        if re.fullmatch(r"[A-Za-z0-9+/=_\-\s]+", text):
            text = _base64(text).decode("utf-8-sig").strip()
        lines = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
        if lines and lines[0].partition("://")[0] in _LINK_TYPES:
            nodes = [link_node(line) for line in lines]
        else:
            # Only adapter data is accepted. A feed cannot supply rules, listeners or providers.
            document = yaml.load(text, Loader=_FeedLoader)
            adapters = document.get("proxies") if isinstance(document, dict) else None
            if not isinstance(adapters, list):
                raise PoolError("Subscription contains no proxies")
            nodes = [_adapter_node(adapter) for adapter in adapters]
    except PoolError:
        raise
    except (ValueError, TypeError, RecursionError, yaml.YAMLError):
        raise PoolError("Invalid subscription document") from None
    if not nodes or len(nodes) > 4096 or len({node.name for node in nodes}) != len(nodes):
        raise PoolError("Subscription must contain 1–4096 uniquely named nodes")
    return nodes


def _adapter_node(adapter: object) -> ImportedNode:
    if not isinstance(adapter, dict) or not isinstance(adapter.get("type"), str) or adapter["type"] not in _ADAPTER_TYPES:
        raise PoolError("Unsupported subscription node type")
    name = adapter.get("name")
    if not isinstance(name, str) or not name.strip() or not adapter.get("server"):
        raise PoolError("Invalid subscription node")
    # Topology and local machine settings belong to the Manager. Never import them from a feed.
    forbidden = {"dialer-proxy", "interface-name", "routing-mark", "certificate", "private-key-path"}
    if adapter["type"] != "wireguard":
        forbidden.add("private-key")
    if forbidden.intersection(adapter):
        raise PoolError("Subscription node contains local routing or file settings")
    payload = json.dumps({"proxies": [{**adapter, "name": "upstream"}]}, ensure_ascii=False)
    return ImportedNode(name.strip(), adapter["type"], payload)
