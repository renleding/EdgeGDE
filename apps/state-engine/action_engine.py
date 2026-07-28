"""Action Engine — dynamic tier selection with before/after verification."""
import asyncio, json, logging, time
from typing import Any, Optional
from cdp_connection import CdpConnection
from failure_envelope import FailureEnvelope
from resolver import Resolver
from salestrekker_rules import get_salestrekker_rules
from state_cache import StateCache, build_state_summary
from state_diff import StateDiff
from verification import ActionType, VerificationEngine, VerificationResult

logger = logging.getLogger('state-engine.action')

ALL_TIERS = ['CDP', 'AX', 'JS', 'REACT', 'KEY', 'OS']

class ActionEngine:
    def __init__(self, cdp: CdpConnection, cache: StateCache):
        self.cdp = cdp
        self.cache = cache
        self.verifier = VerificationEngine()
        self.resolver = Resolver(cdp)
        self.rules = get_salestrekker_rules()
        self._tier_stats = {t: {'attempts': 0, 'failures': 0} for t in ALL_TIERS}

    def _select_tiers(self, action_type: ActionType, target: str, 
                      context: Optional[str] = None) -> list:
        """Select optimal tier order based on element type and context."""
        rules = self.rules.get('element_type_map', {})
        priorities = self.rules.get('tier_priorities', {})
        
        # Determine element type
        element_type = 'standard_button'
        if context and 'combobox' in context.lower():
            element_type = 'combobox'
        elif 'save' in target.lower() or action_type == ActionType.SAVE:
            element_type = 'save_button'
        elif context and 'input' in context.lower():
            element_type = 'text_input'
        
        tier_order = priorities.get(element_type, ALL_TIERS)
        
        # Filter out underperforming tiers
        result = []
        for tier in tier_order:
            stats = self._tier_stats.get(tier, {'attempts': 0, 'failures': 0})
            if stats['attempts'] > 5 and stats['failures'] / stats['attempts'] > 0.3:
                logger.info("Skipping underperforming tier %s (fail rate: %.0f%%)",
                           tier, stats['failures']/stats['attempts']*100)
                continue
            result.append(tier)
        
        return result

    async def execute(self, action_type: ActionType, target: str, 
                      value: Optional[str] = None,
                      context: Optional[str] = None) -> dict:
        """Execute action with dynamic tier selection and verification."""
        tiers = self._select_tiers(action_type, target, context)
        before = build_state_summary(await self.cache.get_state())
        
        result = {'status': 'error', 'tiers_attempted': [], 'error': None}
        
        for tier in tiers:
            self._tier_stats[tier]['attempts'] += 1
            start = time.time()
            
            try:
                ok = await self._try_tier(tier, action_type, target, value)
                duration = time.time() - start
                
                if ok:
                    after = build_state_summary(await self.cache.get_state())
                    diff = StateDiff(before, after)
                    verification = self.verifier.verify(action_type, diff, tier)
                    
                    result = {
                        'status': 'success' if verification.success else 'no_state_change',
                        'tier': tier,
                        'tiers_attempted': tiers[:tiers.index(tier)+1],
                        'duration': round(duration, 2),
                        'verification': verification.__dict__,
                        'diff': diff.summary(),
                    }
                    
                    if verification.success:
                        if not verification.success:
                            self._tier_stats[tier]['failures'] += 1
                        return result
                    
                    self._tier_stats[tier]['failures'] += 1
                else:
                    self._tier_stats[tier]['failures'] += 1
                    
            except Exception as e:
                self._tier_stats[tier]['failures'] += 1
                logger.warning("Tier %s failed: %s", tier, e)
        
        # All tiers failed
        after = build_state_summary(await self.cache.get_state())
        diff = StateDiff(before, after)
        envelope = FailureEnvelope(
            tier=tiers[-1] if tiers else 'none',
            action=f"{action_type.value}:{target}",
            reason="all_tiers_failed",
            page_state=after,
            verification_result=diff.summary()
        )
        result['status'] = 'error'
        result['error'] = envelope.to_dict()
        result['tiers_attempted'] = tiers
        
        return result

    async def _try_tier(self, tier: str, action_type: ActionType,
                        target: str, value: Optional[str]) -> bool:
        """Execute a specific tier's action."""
        if tier == 'CDP':
            return await self._tier_cdp(action_type, target, value)
        elif tier == 'AX':
            return await self._tier_ax(action_type, target, value)
        elif tier == 'JS':
            return await self._tier_js(action_type, target, value)
        elif tier == 'REACT':
            return await self._tier_react(action_type, target, value)
        elif tier == 'KEY':
            return await self._tier_key(action_type, target, value)
        elif tier == 'OS':
            # Placeholder for pyautogui/Agent-S tier
            logger.info("OS tier not yet implemented")
            return False
        return False

    async def _tier_cdp(self, action_type: ActionType, target: str, 
                        value: Optional[str]) -> bool:
        expr = f'''()=>{{for(var b of document.querySelectorAll('button,[role=button],a,[role=combobox]')){{if((b.textContent||'').trim()==='{target}'&&b.offsetParent){{var r=b.getBoundingClientRect();return{{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),disabled:b.disabled}}}}}}return null}}()'''
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': expr, 'returnByValue': True
        })
        coords = r.get('result', {}).get('value')
        if coords and not coords.get('disabled', True):
            await self.cdp.send('Input.dispatchMouseEvent', {
                'type': 'mousePressed', 'x': coords['x'], 'y': coords['y'],
                'button': 'left', 'clickCount': 1
            })
            await self.cdp.send('Input.dispatchMouseEvent', {
                'type': 'mouseReleased', 'x': coords['x'], 'y': coords['y'],
                'button': 'left', 'clickCount': 1
            })
            return True
        return False

    async def _tier_ax(self, action_type: ActionType, target: str,
                       value: Optional[str]) -> bool:
        return False  # AX click not implemented at CDP level

    async def _tier_js(self, action_type: ActionType, target: str,
                       value: Optional[str]) -> bool:
        expr = f'''()=>{{for(var b of document.querySelectorAll('button,[role=button],a[href]')){{if((b.textContent||'').trim()==='{target}'&&b.offsetParent){{b.removeAttribute('disabled');b.click();return true}}}}return false}}()'''
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': expr, 'returnByValue': True
        })
        return r.get('result', {}).get('value', False)

    async def _tier_react(self, action_type: ActionType, target: str,
                          value: Optional[str]) -> bool:
        expr = f'''()=>{{for(var b of document.querySelectorAll('button')){{if((b.textContent||'').trim()==='{target}'){{var pk=Object.keys(b).find(k=>k.startsWith('__reactProps'));if(pk&&b[pk]&&typeof b[pk].onClick==='function'){{b[pk].onClick();return true}}}}}}return false}}()'''
        r = await self.cdp.send('Runtime.evaluate', {
            'expression': expr, 'returnByValue': True
        })
        return r.get('result', {}).get('value', False)

    async def _tier_key(self, action_type: ActionType, target: str,
                        value: Optional[str]) -> bool:
        return False  # Keyboard not implemented at CDP level
