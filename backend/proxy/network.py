"""On-demand latency checks and bounded downloads of a registered subscription."""

import asyncio
import ipaddress
import socket
import time

import httpx

from .formats import MAX_FEED_BYTES, PoolError

LATENCY_URL = "https://www.gstatic.com/generate_204"


async def latency(proxy: str) -> tuple[int | None, str]:
    try:
        async with httpx.AsyncClient(proxy=proxy, trust_env=False, timeout=8) as client:
            start = time.monotonic()
            result = await client.get(LATENCY_URL)
            if result.status_code == 204:
                return round((time.monotonic() - start) * 1000), ""
    except (httpx.HTTPError, ImportError):
        pass
    return None, "Proxy latency check failed"


def subscription_url(value: str) -> httpx.URL:
    try:
        url = httpx.URL(value)
    except httpx.InvalidURL:
        raise PoolError("Invalid subscription URL") from None
    if url.scheme not in {"http", "https"} or not url.host or url.userinfo or url.fragment:
        raise PoolError("Invalid subscription URL")
    return url


async def _public_address(url: httpx.URL) -> str:
    port = url.port or (443 if url.scheme == "https" else 80)
    info = await asyncio.get_running_loop().getaddrinfo(url.host, port, type=socket.SOCK_STREAM)
    addresses = [ipaddress.ip_address(entry[4][0]) for entry in info]
    if not addresses or any(not ip.is_global or ip.is_multicast for ip in addresses):
        raise PoolError("Subscriptions must use a public HTTP(S) address")
    return str(addresses[0])


async def download_subscription(address: str, node_gateway: str | None) -> bytes:
    async def fetch() -> bytes:
        url = subscription_url(address)
        # SOCKS conveys the pinned destination independently of the HTTP Host header.
        proxy = httpx.URL(node_gateway).copy_with(scheme="socks5") if node_gateway else None
        async with httpx.AsyncClient(proxy=proxy, trust_env=False, timeout=12,
                                     limits=httpx.Limits(max_keepalive_connections=0)) as client:
            for _ in range(4):
                # Validate every hop, including redirects. Pin the resolved destination but keep TLS SNI/Host.
                address_ip = await _public_address(url)
                headers = {"Host": url.netloc.decode("ascii"), "Accept-Encoding": "identity", "User-Agent": "clash.meta"}
                async with client.stream("GET", url.copy_with(host=address_ip), headers=headers,
                                         extensions={"sni_hostname": url.raw_host.decode("ascii")}) as response:
                    if response.is_redirect and response.headers.get("location"):
                        url = subscription_url(str(url.join(response.headers["location"])))
                        continue
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes(65536):
                        body.extend(chunk)
                        if len(body) > MAX_FEED_BYTES:
                            raise PoolError("Invalid subscription size")
                    return bytes(body)
            raise PoolError("Too many subscription redirects")

    try:
        return await asyncio.wait_for(fetch(), timeout=35)
    except (OSError, asyncio.TimeoutError, httpx.HTTPError, httpx.InvalidURL):
        # A provider URL often carries a token. Never surface the exception's URL.
        raise PoolError("Could not download this subscription", 502) from None
