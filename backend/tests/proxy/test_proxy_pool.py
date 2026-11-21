import base64
from contextlib import asynccontextmanager
import json
from pathlib import Path
import re
from unittest.mock import AsyncMock, patch

import pytest

from backend.proxy import formats, kernel, network, store

ROOT = "/api/proxy-pool"
LINK = "vless://00000000-0000-4000-8000-000000000001@node.example:443#Office"


def test_profile_only_accepts_pool_members(app_client):
    client = app_client
    assert client.post(f"{ROOT}/homes", json={"lines": "proxy.example:1080:user:p@ss#Home\nproxy.example:1080:user:new"}).is_success
    assert client.post(f"{ROOT}/nodes", json={"link": LINK}).is_success
    pool = client.get(ROOT).json()
    [home], [node] = pool['homes'], pool['nodes']
    assert home['endpoint'] == 'socks5://proxy.example:1080'
    assert 'p@ss' not in str(pool) and 'payload' not in node
    ref = f"pool:{home['id']}:{node['id']}"
    profile = client.post('/api/profiles', json={'name': 'Work', 'proxy': ref}).json()
    assert profile['proxy'] == ref
    for value in ('http://proxy.example:8080', 'pool::', 'node://auto'):
        assert client.post('/api/profiles', json={'name': 'bad', 'proxy': value}).status_code == 400
    assert client.put(f"/api/profiles/{profile['id']}", json={'proxy': 'pool::' + '0' * 32}).status_code == 409
    assert client.delete(f"{ROOT}/homes/{home['id']}").status_code == 409
    assert client.delete(f"{ROOT}/nodes/{node['id']}").status_code == 409
    assert client.put(f"/api/profiles/{profile['id']}", json={'proxy': None}).is_success
    assert client.delete(f"{ROOT}/homes/{home['id']}").is_success


def test_failed_home_import_is_atomic_and_redacted(app_client):
    r = app_client.post(f"{ROOT}/homes", json={'lines': 'a.example:8000\nhttp://user:private@no-port'})
    assert r.status_code == 400 and r.json()['detail'] == 'Invalid proxy address on line 2'
    assert not app_client.get(ROOT).json()['homes']


def test_editor_prefills_credentials_and_home_import_accepts_names(app_client):
    c = app_client
    url = 'https://user:p%40ss@proxy.example:8080'
    assert c.post(f'{ROOT}/homes', json={'name': 'Office', 'lines': url, 'group': 'QA'}).is_success
    assert c.post(f'{ROOT}/nodes', json={'name': 'Relay', 'link': LINK}).is_success
    feed = 'https://provider.example/feed?token=fake-test-token'
    sid = c.post(f'{ROOT}/subscriptions', json={'name': 'Provider', 'url': feed}).json()['id']
    catalog = c.get(ROOT).json()
    home, node = catalog['homes'][0], catalog['nodes'][0]
    assert 'p%40ss' not in str(catalog) and 'fake-test-token' not in str(catalog) and LINK not in str(catalog)
    detail = c.get(f"{ROOT}/homes/{home['id']}")
    assert detail.headers['cache-control'] == 'no-store'
    assert detail.json() == {'name': 'Office', 'group_name': 'QA', 'address': url, 'scheme': 'https'}
    assert c.get(f"{ROOT}/nodes/{node['id']}").json() == {'name': 'Relay', 'address': LINK}
    assert c.get(f'{ROOT}/subscriptions/{sid}').json() == {'name': 'Provider', 'address': feed}
    assert c.post(f'{ROOT}/homes', json={'name': 'Set', 'lines': 'a.example:80\nb.example:80#Custom'}).is_success
    assert {x['name'] for x in c.get(ROOT).json()['homes']} == {'Office', 'Set 1', 'Custom'}


def test_successful_sync_overwrites_local_edits_and_restores_deletions(app_client):
    c = app_client
    sid = c.post(f'{ROOT}/subscriptions', json={'name': 'Provider', 'url': 'https://provider.example/feed'}).json()['id']
    adapter = {'name': 'TLS node', 'type': 'http', 'server': 'origin.example', 'port': 443, 'tls': True, 'sni': 'tls.example'}
    feed = json.dumps({'proxies': [adapter, {**adapter, 'name': 'Second'}, {**adapter, 'name': 'Third'}]}).encode()
    with patch.object(network, 'download_subscription', AsyncMock(return_value=feed)) as fetch:
        sync = f'{ROOT}/subscriptions/{sid}/sync'
        assert c.post(sync, json={}).is_success
        original = {n['name']: n['id'] for n in c.get(ROOT).json()['nodes']}
        first, second, third = (original[n] for n in ('TLS node', 'Second', 'Third'))
        details = c.get(f'{ROOT}/nodes/{first}').json()
        config = json.loads(details['address'])
        assert config['sni'] == adapter['sni']  # Editing preserves options with no lossless URL representation.
        assert c.put(f'{ROOT}/nodes/{first}', json={'link': details['address'], 'name': 'Local alias'}).is_success
        assert c.put(f'{ROOT}/nodes/{second}', json={'link': LINK, 'name': 'Local relay'}).is_success
        assert c.delete(f'{ROOT}/nodes/{third}').is_success
        edited = c.get(ROOT).json()['nodes']
        assert {n['name'] for n in edited} == {'Local alias', 'Local relay'}
        assert all(n['source_id'] == sid for n in edited)
        fetch.return_value = b'bad subscription'
        assert c.post(sync, json={}).status_code == 400 and c.get(ROOT).json()['nodes'] == edited
        fetch.return_value = feed
        assert c.post(sync, json={}).is_success
        assert {n['name']: n['id'] for n in c.get(ROOT).json()['nodes']} == original
        assert json.loads(c.get(f'{ROOT}/nodes/{second}').json()['address']) == config


@pytest.mark.parametrize('kind', ['homes', 'nodes'])
def test_bulk_delete_only_selected_items_and_rollback_when_in_use(app_client, kind):
    c = app_client
    for name in ('A', 'B', 'C'):
        body = {'name': name, 'lines': f'{name}.example:8080'} if kind == 'homes' else {'name': name, 'link': LINK}
        assert c.post(f'{ROOT}/{kind}', json=body).is_success
    a, b, other = [item['id'] for item in c.get(ROOT).json()[kind]]
    selection = f'pool:{b}:' if kind == 'homes' else f'pool::{b}'
    pid = c.post('/api/profiles', json={'name': 'Using B', 'proxy': selection}).json()['id']
    delete = f'{ROOT}/{kind}/bulk-delete'
    assert c.post(delete, json={'ids': [a, b]}).status_code == 409
    assert c.put(f'/api/profiles/{pid}', json={'proxy': None}).is_success
    assert c.post(delete, json={'ids': [a, '0' * 32]}).status_code == 404
    assert c.post(delete, json={'ids': [a, b, b]}).json() == {'count': 2}
    assert [item['id'] for item in c.get(ROOT).json()[kind]] == [other]


def test_sync_updates_only_requested_subscription_via_exact_node(app_client):
    client = app_client
    ids = [client.post(f"{ROOT}/subscriptions", json={'name': s, 'url': f'https://{s}.example/feed'}).json()['id'] for s in ('a', 'b')]
    download = AsyncMock(return_value=base64.b64encode(LINK.encode()))
    with patch.object(network, 'download_subscription', download):
        r = client.post(f"{ROOT}/subscriptions/{ids[0]}/sync", json={})
        assert r.json() == {'count': 1}
        download.assert_awaited_once_with('https://a.example/feed', None)
        [first] = client.get(ROOT).json()['nodes']

        @asynccontextmanager
        async def selected(runtime, home, payload):
            assert not home and base64.b64decode(payload).decode() == LINK
            yield 'http://selected.example:1234'

        with patch.object(kernel, 'route', selected):
            assert client.post(f"{ROOT}/subscriptions/{ids[1]}/sync", json={'node_id': first['id']}).is_success
            download.assert_awaited_with('https://b.example/feed', 'http://selected.example:1234')
        before = client.get(ROOT).json()
        assert len({n['id'] for n in before['nodes']}) == 2  # same node name, two providers
        download.return_value = b'not a subscription'
        assert client.post(f"{ROOT}/subscriptions/{ids[0]}/sync", json={}).status_code == 400
        assert client.get(ROOT).json() == before
        download.return_value = LINK.replace('Office', 'New').encode()
        assert client.post(f"{ROOT}/subscriptions/{ids[0]}/sync", json={}).is_success
        after = client.get(ROOT).json()['nodes']
        assert {(n['source_id'], n['name']) for n in after} == {(ids[0], 'New'), (ids[1], 'Office')}
        assert first['id'] not in {n['id'] for n in after}


def test_latency_is_one_library_item(app_client):
    app_client.post(f"{ROOT}/homes", json={'lines': 'http://a.example:8000\nhttp://b.example:8000'})
    a, b = app_client.get(ROOT).json()['homes']
    with patch.object(network, 'latency', AsyncMock(return_value=(17, ''))) as latency:
        assert app_client.post(f"{ROOT}/homes/{a['id']}/latency").json()['latency_ms'] == 17
        latency.assert_awaited_once_with(a['endpoint'])
    a2, b2 = app_client.get(ROOT).json()['homes']
    assert a2['latency_ms'] == 17 and b2 == b


def test_yaml_is_only_adapter_data_and_has_bounded_expansion():
    body = b'proxies:\n  - {name: A, type: http, server: a.example, port: 8080}\nrules: [MATCH,DIRECT]'
    [node] = formats.subscription_nodes(body)
    assert node.name == 'A' and 'rules' not in node.payload
    with pytest.raises(formats.PoolError):
        formats.subscription_nodes(b'proxies: &a [*a]')


def test_feed_requires_public_destination():
    import asyncio
    with pytest.raises(formats.PoolError, match='public'):
        asyncio.run(network.download_subscription('http://127.0.0.1/private', None))


def test_late_sync_cannot_overwrite_newer_snapshot(tmp_db):
    store.init()
    sid = store.save_subscription('Provider', 'https://provider.example/feed')
    snapshot = store.subscription(sid)
    store.replace_subscription(snapshot, [formats.link_node(LINK)])
    with pytest.raises(formats.PoolError, match='changed'):
        store.replace_subscription(snapshot, [])
    assert len(store.catalog()['nodes']) == 1


def test_no_duplicate_translation_keys():
    text = (Path(__file__).resolve().parents[3] / 'frontend/src/i18n/zh-CN.ts').read_text('utf-8')
    keys = re.findall(r'^  ("[^"\n]*"|\w+):', text, re.M)
    names = [key.strip('"') for key in keys]
    assert len(names) == len(set(names))
