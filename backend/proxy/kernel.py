"""An authenticated loopback listener with one immutable, explicitly chosen route."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
from tempfile import TemporaryDirectory

import httpx

from ..runtime import RuntimeConfig, bundle_dir
from . import store
from .formats import PoolError, Selection, endpoint_adapter


EXE = "mihomo.exe" if os.name == "nt" else "mihomo"


def executable(runtime: RuntimeConfig, configured: str) -> str | None:
    if configured:
        path = Path(configured)
        if not path.is_absolute() or path.drive.startswith("\\\\") or path.name.lower() != EXE:
            return None
        resolved = path.resolve()
        if resolved.is_relative_to(runtime.data_dir.resolve()) and resolved.parent != (runtime.data_dir / "bin").resolve():
            return None
        return str(resolved) if resolved.is_file() else None
    for root in (bundle_dir(), runtime.data_dir):
        path = root / "bin" / EXE
        if path.is_file():
            return str(path)
    return shutil.which(EXE)


def _ports() -> tuple[int, int]:
    with socket.socket() as mixed, socket.socket() as controller:
        mixed.bind(("127.0.0.1", 0))
        controller.bind(("127.0.0.1", 0))
        return mixed.getsockname()[1], controller.getsockname()[1]


def configuration(home: str | None, mixed: int, controller: int, secret: str) -> dict:
    config = {
        "mixed-port": mixed, "bind-address": "127.0.0.1", "allow-lan": False,
        "external-controller": f"127.0.0.1:{controller}", "secret": secret,
        "authentication": [f"profile:{secret}"], "skip-auth-prefixes": [],
        "mode": "rule", "log-level": "warning", "geo-auto-update": False,
        "profile": {"store-selected": False},
        "proxy-providers": {"member": {
            "type": "file", "path": "./member.txt", "health-check": {"enable": False},
            "override": {"additional-prefix": "member-"},
        }},
        "proxy-groups": [{"name": "NODE", "type": "select", "use": ["member"], "empty-fallback": "REJECT"}],
        "rules": ["MATCH,NODE"],
    }
    if home:
        adapter = {**endpoint_adapter(home), "name": "HOME", "dialer-proxy": "NODE"}
        config.update(proxies=[adapter], rules=["MATCH,HOME"])
    return config


async def _ready(proc: subprocess.Popen, controller: int, secret: str) -> None:
    headers = {"Authorization": f"Bearer {secret}"}
    async with httpx.AsyncClient(trust_env=False, timeout=0.8) as client:
        for _ in range(55):
            if proc.poll() is not None:
                raise PoolError("mihomo rejected the node configuration")
            try:
                response = await client.get(f"http://127.0.0.1:{controller}/providers/proxies/member", headers=headers)
                if response.is_success:
                    members = response.json().get("proxies", [])
                    if len(members) == 1 and members[0].get("type") not in {"Direct", "Compatible", "Pass", "Reject"}:
                        return
                    raise PoolError("The selected node could not be loaded by mihomo")
            except httpx.TransportError:
                pass  # Controller not listening yet.
            await asyncio.sleep(0.1)
    raise PoolError("Timed out starting mihomo")


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


@asynccontextmanager
async def route(runtime: RuntimeConfig, home: str | None, node: str | None):
    if node is None:
        yield home
        return
    binary = executable(runtime, store.kernel_path())
    if not binary:
        raise PoolError("Install or select mihomo to use a proxy node")
    mixed, controller = _ports()
    secret = secrets.token_hex(20)
    # A running browser owns its snapshot. Syncing another feed cannot change its route.
    with TemporaryDirectory(prefix="node-", dir=runtime.data_dir) as work:
        root = Path(work)
        (root / "member.txt").write_text(node + "\n", encoding="utf-8")
        config = root / "config.yaml"
        config.write_text(json.dumps(configuration(home, mixed, controller, secret)), encoding="utf-8")
        try:
            proc = subprocess.Popen([binary, "-d", work, "-f", str(config)], stdin=subprocess.DEVNULL,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except OSError:
            raise PoolError("Could not start the configured mihomo executable") from None
        try:
            await _ready(proc, controller, secret)
            yield f"http://profile:{secret}@127.0.0.1:{mixed}"
        finally:
            await asyncio.to_thread(_stop, proc)


def selected_route(runtime: RuntimeConfig, value: str | None):
    return route(runtime, *store.resolve(Selection.parse(value)))
