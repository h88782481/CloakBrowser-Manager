"""Keep pool selection and worker lifetime outside the upstream browser launcher."""

from contextlib import AsyncExitStack

from ..browser_manager import BrowserManager, RunningProfile, test_proxy
from .kernel import selected_route


class PoolBrowserManager(BrowserManager):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._workers: dict[int, AsyncExitStack] = {}

    async def launch(self, profile: dict) -> RunningProfile:
        if profile.get("proxy") is None:
            return await super().launch(profile)
        async with AsyncExitStack() as lease:
            proxy = await lease.enter_async_context(selected_route(self.runtime, profile["proxy"]))
            running = await super().launch({**profile, "proxy": proxy})
            self._workers[id(running)] = lease.pop_all()
            return running

    async def _dispose_running(self, running: RunningProfile, *, close_context: bool):
        try:
            await super()._dispose_running(running, close_context=close_context)
        finally:
            lease = self._workers.pop(id(running), None)
            if lease is not None:
                await lease.aclose()

    async def test_proxy(self, value: str) -> dict:
        async with selected_route(self.runtime, value) as proxy:
            return await test_proxy(proxy)
