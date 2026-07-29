"""CDP Connection — synchronous send/recv per call."""
import asyncio, json, logging
from typing import Any, Callable, Optional
import requests, websockets

logger = logging.getLogger('state-engine.cdp')

class CdpConnection:
    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self.ws = None
        self._msg_id = 0
        self._pending = {}
        self._loop = None
        self._reader_task = None
        self._subscribers = []

    async def connect(self):
        self.ws = await websockets.connect(self.ws_url, max_size=2**26)
        self._loop = asyncio.get_event_loop()
        self._reader_task = asyncio.create_task(self._reader())
        logger.info("Connected: %s", self.ws_url[:60])

    async def _reader(self):
        try:
            async for msg in self.ws:
                data = json.loads(msg)
                msg_id = data.get('id')
                if msg_id in self._pending:
                    fut = self._pending.pop(msg_id)
                    if not fut.done():
                        fut.set_result(data)
                else:
                    evt = data.get('method')
                    for cb in self._subscribers:
                        try: cb(data)
                        except: pass
        except Exception as e:
            logger.warning("Reader stopped: %s", e)

    def subscribe(self, callback: Callable):
        self._subscribers.append(callback)

    async def send(self, method: str, params: dict = None, timeout: float = 15) -> dict:
        self._msg_id += 1
        msg_id = self._msg_id
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        fut = self._loop.create_future()
        self._pending[msg_id] = fut
        await self.ws.send(payload)
        try:
            result = await asyncio.wait_for(fut, timeout=timeout)
            if 'error' in result:
                logger.warning("CDP error %s: %s", method, result['error'])
            return result.get('result', {})
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            logger.warning("CDP command timed out: %s", method)
            return {}

    async def close(self):
        if self._reader_task:
            self._reader_task.cancel()
        if self.ws:
            await self.ws.close()
