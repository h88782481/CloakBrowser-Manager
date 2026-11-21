"""Endpoints for the manual proxy library."""

from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from . import kernel, network, store
from .formats import MAX_FEED_BYTES, PoolError, Selection, node_from_editor, subscription_nodes
from .manager import PoolBrowserManager

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ItemId = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
Scheme = Literal["http", "https", "socks5"]
Kind = Literal["homes", "nodes", "subscriptions"]
ProxyKind = Literal["homes", "nodes"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class HomeImport(Payload):
    lines: str = Field(min_length=1, max_length=524288)
    name: str = Field(default="", max_length=200)
    group: str = Field(default="", max_length=100)
    scheme: Scheme = "socks5"


class HomeEdit(Payload):
    name: Name
    group: str = Field(default="", max_length=100)
    address: str | None = Field(default=None, max_length=4096)
    scheme: Scheme = "socks5"


class NodeInput(Payload):
    name: str = Field(default="", max_length=200)
    link: str = Field(min_length=1, max_length=MAX_FEED_BYTES)


class SelectedItems(Payload):
    ids: list[ItemId] = Field(min_length=1, max_length=4096)


class SubscriptionInput(Payload):
    name: Name
    url: str | None = Field(default=None, max_length=4096)


class Sync(Payload):
    node_id: ItemId | None = None


class KernelPath(Payload):
    path: str = Field(max_length=1024)


def register_pool(app: FastAPI, manager: PoolBrowserManager) -> None:
    router = APIRouter(prefix="/api/proxy-pool", tags=["proxy pool"])

    @app.exception_handler(PoolError)
    async def pool_error(request: Request, exc: PoolError):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @router.get("")
    def catalog():
        path = store.kernel_path()
        return {**store.catalog(), "kernel_path": path, "kernel_available": bool(kernel.executable(manager.runtime, path))}

    @router.get("/{kind}/{item_id}")
    def edit_details(kind: Kind, item_id: ItemId, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return store.edit_details(kind, item_id)

    @router.put("/kernel")
    def save_kernel(body: KernelPath):
        if body.path and not kernel.executable(manager.runtime, body.path):
            raise PoolError("Select the installed mihomo executable")
        store.set_kernel_path(body.path)
        return {"ok": True}

    @router.post("/homes")
    def import_homes(body: HomeImport):
        return {"count": store.import_homes(body.lines, body.scheme, body.group, body.name)}

    @router.put("/homes/{item_id}")
    def edit_home(item_id: ItemId, body: HomeEdit):
        store.edit_home(item_id, body.name, body.group, body.address, body.scheme)
        return {"ok": True}

    @router.post("/nodes")
    def add_node(body: NodeInput):
        store.save_node(node_from_editor(body.link, body.name))
        return {"ok": True}

    @router.put("/nodes/{item_id}")
    def edit_node(item_id: ItemId, body: NodeInput):
        store.save_node(node_from_editor(body.link, body.name), item_id)
        return {"ok": True}

    @router.post("/subscriptions")
    def add_subscription(body: SubscriptionInput):
        url = str(network.subscription_url(body.url)) if body.url else None
        return {"id": store.save_subscription(body.name, url)}

    @router.put("/subscriptions/{item_id}")
    def edit_subscription(item_id: ItemId, body: SubscriptionInput):
        url = str(network.subscription_url(body.url)) if body.url else None
        store.save_subscription(body.name, url, item_id)
        return {"ok": True}

    @router.post("/subscriptions/{item_id}/sync")
    async def sync_subscription(item_id: ItemId, body: Sync):
        source = store.subscription(item_id)
        home, node = store.resolve(Selection(node=body.node_id or ""))
        async with kernel.route(manager.runtime, home, node) as proxy:
            content = await network.download_subscription(source["url"], proxy)
        nodes = subscription_nodes(content)
        store.replace_subscription(source, nodes)
        return {"count": len(nodes)}

    @router.post("/{kind}/{item_id}/latency")
    async def measure(kind: ProxyKind, item_id: ItemId):
        selection = Selection(home=item_id) if kind == "homes" else Selection(node=item_id)
        home, node = store.resolve(selection)
        try:
            async with kernel.route(manager.runtime, home, node) as proxy:
                ms, error = await network.latency(proxy)
        except PoolError as exc:
            ms, error = None, str(exc)
        store.record_latency(selection, home or node, ms, error)
        return {"latency_ms": ms, "error": error}

    @router.post("/{kind}/bulk-delete")
    def bulk_delete(kind: ProxyKind, body: SelectedItems):
        return {"count": store.delete_items(kind, body.ids)}

    @router.delete("/{kind}/{item_id}")
    def delete(kind: Kind, item_id: ItemId):
        store.delete_items(kind, [item_id])
        return {"ok": True}

    app.include_router(router)
