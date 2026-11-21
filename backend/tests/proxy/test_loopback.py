"""Optional data-plane tests with the packaged mihomo. All peers are fixed loopback fixtures."""

import asyncio
from contextlib import asynccontextmanager
import json
import os
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.proxy import formats, kernel, network, store
from backend.runtime import RuntimeConfig


@asynccontextmanager
async def listener(handler):
    async def serve(reader, writer):
        try:
            header = await reader.readuntil(b'\r\n\r\n')
            await handler(header, reader, writer)
        finally:
            writer.close()
            await writer.wait_closed()

    async with await asyncio.start_server(serve, '127.0.0.1', 0) as server:
        yield server.sockets[0].getsockname()[1]


def fixed_hop(name, port, visits):
    """This fixture can reach only the local port supplied by its caller."""
    async def handle(header, reader, writer):
        method, target, _ = header.split(b'\r\n', 1)[0].decode().split(' ', 2)
        expected = f'127.0.0.1:{port}'
        if target != expected and not target.startswith(f'http://{expected}/'):
            visits.append(('unexpected destination', target))
            writer.write(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
            return
        visits.append(name)
        upstream, outbound = await asyncio.open_connection('127.0.0.1', port)
        try:
            if method == 'CONNECT':
                writer.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
            else:
                outbound.write(header)
            async def copy(src, dst):
                while data := await src.read(8192):
                    dst.write(data)
                    await dst.drain()
            tasks = [asyncio.create_task(copy(reader, outbound)), asyncio.create_task(copy(upstream, writer))]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            outbound.close()
            await outbound.wait_closed()
    return handle


@pytest.fixture()
def anyio_backend():
    return 'asyncio'


@pytest.fixture()
def runtime(tmp_db):
    store.init()
    return RuntimeConfig('windows' if os.name == 'nt' else 'linux', 'native', 'native-window', tmp_db)


@pytest.mark.anyio
@pytest.mark.parametrize(('use_home', 'use_node'), [(False, False), (True, False), (False, True), (True, True)])
async def test_exact_hop_order(runtime, use_home, use_node, monkeypatch):
    if use_node:
        binary = os.environ.get('POOL_TEST_MIHOMO')
        if not binary:
            pytest.skip('set POOL_TEST_MIHOMO to run with a real kernel')
        store.set_kernel_path(binary)
    visits = []
    feed = b'vless://00000000-0000-4000-8000-000000000001@node.example:443#Example'

    async def origin(header, reader, writer):
        visits.append('origin')
        if b'/delay ' in header.split(b'\r\n', 1)[0]:
            writer.write(b'HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n')
        else:
            writer.write(f'HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {len(feed)}\r\n\r\n'.encode() + feed)
        await writer.drain()

    async with listener(origin) as dest, listener(fixed_hop('home', dest, visits)) as home:
        async with listener(fixed_hop('node', home if use_home else dest, visits)) as node:
            entry = {'name': 'Fixture', 'type': 'http', 'server': '127.0.0.1', 'port': node}
            payload = formats.subscription_nodes(json.dumps({'proxies': [entry]}).encode())[0].payload
            async with kernel.route(runtime, f'http://127.0.0.1:{home}' if use_home else None, payload if use_node else None) as proxy:
                expected = (['node'] if use_node else []) + (['home'] if use_home else []) + ['origin']
                async with httpx.AsyncClient(proxy=proxy, trust_env=False, timeout=4) as client:
                    assert (await client.get(f'http://127.0.0.1:{dest}/fixture')).content == feed
                assert visits == expected
                if use_node and not use_home:
                    visits.clear()
                    # Replace only address policy for this fixture; transport goes through the actual node.
                    monkeypatch.setattr(network, '_public_address', AsyncMock(return_value='127.0.0.1'))
                    assert await network.download_subscription(f'http://subscription.example:{dest}/feed', proxy) == feed
                    assert visits == expected
                if use_home != use_node:
                    visits.clear()
                    monkeypatch.setattr(network, 'LATENCY_URL', f'http://127.0.0.1:{dest}/delay')
                    ms, error = await network.latency(proxy)
                    assert ms is not None and not error and visits == expected
    assert not list(runtime.data_dir.glob('node-*'))


@pytest.mark.anyio
async def test_standalone_share_link_loads_exactly_one_native_member(runtime):
    binary = os.environ.get('POOL_TEST_MIHOMO')
    if not binary:
        pytest.skip('set POOL_TEST_MIHOMO to run with a real kernel')
    store.set_kernel_path(binary)
    node = formats.link_node('vless://00000000-0000-4000-8000-000000000001@127.0.0.1:1?type=tcp#Local')
    store.save_node(node)
    [entry] = store.catalog()['nodes']
    async with kernel.selected_route(runtime, f"pool::{entry['id']}") as proxy:
        assert httpx.URL(proxy).host == '127.0.0.1'
    assert not list(runtime.data_dir.glob('node-*'))
