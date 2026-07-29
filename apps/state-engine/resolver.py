"""Resolver — multi-strategy element resolution with confidence scores."""
import json, logging
from typing import Any, Optional

logger = logging.getLogger('state-engine.resolver')

class ResolvedElement:
    def __init__(self, element_id: str, confidence: float, 
                 strategy: str = "", tag: str = "", text: str = "",
                 coords: Optional[dict] = None):
        self.element_id = element_id
        self.confidence = confidence
        self.strategy = strategy
        self.tag = tag
        self.text = text
        self.coords = coords

class Resolver:
    def __init__(self, cdp):
        self.cdp = cdp

    async def resolve(self, target: str, context: Optional[str] = None) -> Optional[ResolvedElement]:
        methods = [
            ("ax_tree", self._resolve_ax, 0.9),
            ("dom_exact", self._resolve_dom_exact, 0.8),
            ("dom_includes", self._resolve_dom_includes, 0.7),
            ("aria", self._resolve_aria, 0.6),
        ]
        
        best = None
        for name, method, base_conf in methods:
            try:
                result = await method(target, context)
                if result:
                    confidence = base_conf * (1.0 - 0.1 * len(methods))
                    result.confidence = min(confidence, 1.0)
                    best = result
                    logger.debug("Resolver %s found %s (conf=%.2f)", name, target, result.confidence)
                    break
            except Exception as e:
                logger.debug("Resolver %s failed: %s", name, e)
        
        if best and best.confidence < 0.5:
            logger.warning("Low confidence resolution: %s (%.2f)", target, best.confidence)
            
        return best

    async def _resolve_ax(self, target: str, context: Optional[str]) -> Optional[ResolvedElement]:
        r = await self.cdp.send('Accessibility.getSnapshot', {'interestingOnly': False})
        nodes = r.get('nodes', [])
        for i, node in enumerate(nodes):
            name = node.get('name', '')
            if isinstance(name, dict):
                name = name.get('value', '')
            role = node.get('role', {}).get('value', '')
            if target.lower() in name.lower() or target.lower() in role.lower():
                return ResolvedElement(
                    element_id=str(i), strategy="ax_tree",
                    tag=role, text=name[:30]
                )
        return None

    async def _resolve_dom_exact(self, target: str, context: Optional[str]) -> Optional[ResolvedElement]:
        selector = f'[name="{target}"], [id="{target}"], [aria-label="{target}"]'
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': f'document.querySelector(\'{selector}\')?.outerHTML || ""',
            'returnByValue': True
        })
        html = r.get('result', {}).get('value', '')
        if html:
            return ResolvedElement(element_id=target, strategy="dom_exact",
                                   tag=html[:20], text=target)
        return None

    async def _resolve_dom_includes(self, target: str, context: Optional[str]) -> Optional[ResolvedElement]:
        expr = f'''()=>{{for(var e of document.querySelectorAll('button,[role=button],a,input,select')){{if(e.offsetParent&&(e.textContent||'').trim().toLowerCase().includes('{target.lower()}'))return e.outerHTML.substring(0,100)}}return ''}}()'''
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': expr, 'returnByValue': True
        })
        html = r.get('result', {}).get('value', '')
        if html:
            return ResolvedElement(element_id=target, strategy="dom_includes",
                                   tag=html[:20], text=target)
        return None

    async def _resolve_aria(self, target: str, context: Optional[str]) -> Optional[ResolvedElement]:
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': f'document.querySelector(\'[aria-describedby*="{target}"],[aria-label*="{target}"]\')?.outerHTML || ""',
            'returnByValue': True
        })
        html = r.get('result', {}).get('value', '')
        if html:
            return ResolvedElement(element_id=target, strategy="aria",
                                   tag=html[:20], text=target)
        return None
