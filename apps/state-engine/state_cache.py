"""State Cache — lazy-refreshed DOM + AX state."""
import asyncio, json, logging
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger('state-engine.cache')

class CacheDirty(Enum):
    CLEAN = 0
    DIRTY = 1
    DIRTY_CRITICAL = 2

class PageSnapshot:
    def __init__(self, url="", buttons=None, inputs=None, comboboxes=None, 
                 dialogs=None, errors=None, toast=None, body_text=""):
        self.url = url
        self.buttons = buttons or []
        self.inputs = inputs or []
        self.comboboxes = comboboxes or []
        self.dialogs = dialogs or []
        self.errors = errors or []
        self.toast = toast
        self.body_text = body_text

class StateCache:
    def __init__(self, cdp):
        self.cdp = cdp
        self._snapshot = None
        self._dirty = CacheDirty.DIRTY_CRITICAL
        self._last_state = None

    def invalidate(self, level=CacheDirty.DIRTY):
        if self._dirty.value < level.value:
            self._dirty = level

    async def get_state(self) -> PageSnapshot:
        if self._dirty == CacheDirty.CLEAN and self._snapshot:
            return self._snapshot
        
        try:
            url = await self._get_url()
            buttons = await self._get_buttons()
            inputs = await self._get_inputs()
            comboboxes = await self._get_comboboxes()
            errors = await self._get_page_errors()
            toast = await self._get_toast()
            
            self._snapshot = PageSnapshot(
                url=url, buttons=buttons, inputs=inputs,
                comboboxes=comboboxes, errors=errors, toast=toast
            )
            self._dirty = CacheDirty.CLEAN
        except Exception as e:
            logger.error("State capture failed: %s", e)
            self._dirty = CacheDirty.DIRTY_CRITICAL
        
        return self._snapshot or PageSnapshot()

    async def _get_url(self) -> str:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': 'window.location.href',
            'returnByValue': True
        })
        return r.get('result', {}).get('value', '')

    async def _get_buttons(self) -> list:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': '''()=>{return Array.from(document.querySelectorAll('button')).filter(b=>b.offsetParent).map(b=>({text:b.textContent.trim().substring(0,30),disabled:b.disabled}))}()''',
            'returnByValue': True
        })
        return r.get('result', {}).get('value', [])

    async def _get_inputs(self) -> list:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': '''()=>{return Array.from(document.querySelectorAll('input[name]')).filter(i=>i.offsetParent).map(i=>({name:i.getAttribute('name')||'',value:(i.value||'').substring(0,20)}))}()''',
            'returnByValue': True
        })
        return r.get('result', {}).get('value', [])

    async def _get_comboboxes(self) -> list:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': '''()=>{return Array.from(document.querySelectorAll('[role="combobox"]')).filter(c=>c.offsetParent).map(c=>({name:c.getAttribute('name')||'',text:c.textContent.trim().substring(0,20)}))}()''',
            'returnByValue': True
        })
        return r.get('result', {}).get('value', [])

    async def _get_page_errors(self) -> list:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': '''()=>{var e=document.querySelector('[class*=error],[class*=alert],[role=alert]');return e?[e.textContent.trim().substring(0,100)]:[]}()''',
            'returnByValue': True
        })
        return r.get('result', {}).get('value', [])

    async def _get_toast(self) -> Optional[str]:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': '''()=>{var t=document.querySelector('[class*=toast]');return t?t.textContent.trim().substring(0,100):null}()''',
            'returnByValue': True
        })
        return r.get('result', {}).get('value')

def build_state_summary(snapshot: PageSnapshot) -> dict:
    return {
        'url': snapshot.url[:80],
        'buttons': len(snapshot.buttons),
        'inputs': len(snapshot.inputs),
        'comboboxes': len(snapshot.comboboxes),
        'dialogs': len(snapshot.dialogs),
        'errors': snapshot.errors,
        'toast': snapshot.toast,
    }
