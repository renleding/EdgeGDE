"""Workflow Engine — YAML workflow loader and executor."""
import json, logging, os
from pathlib import Path
from typing import Any, Optional
import yaml

logger = logging.getLogger('state-engine.workflow')

WORKFLOW_DIR = os.path.expanduser("~/.hermes/workflows/")

class WorkflowEngine:
    def __init__(self, action_engine=None):
        self.action_engine = action_engine
        self.workflows = {}
        self._load_workflows()

    def _load_workflows(self):
        try:
            wf_dir = Path(WORKFLOW_DIR)
            if wf_dir.exists():
                for f in wf_dir.glob("*.yaml"):
                    with open(f) as fh:
                        wf = yaml.safe_load(fh)
                        if wf and 'name' in wf:
                            self.workflows[wf['name']] = wf
                            logger.info("Loaded workflow '%s' (%d steps) from %s",
                                       wf['name'], len(wf.get('steps', [])), f.name)
        except Exception as e:
            logger.warning("Failed to load workflows: %s", e)
        
        # Also load from embedded defaults
        self._load_defaults()
        logger.info("Loaded %d workflows total", len(self.workflows))

    def _load_defaults(self):
        defaults = {
            'add_vehicle_asset': {
                'name': 'add_vehicle_asset',
                'description': 'Add a vehicle asset to a deal',
                'steps': [
                    {'action': 'click', 'target': 'Add asset'},
                    {'action': 'wait', 'seconds': 2},
                    {'action': 'select_combobox', 'target': 'Vehicle'},
                    {'action': 'type', 'target': 'value', 'value': '${asset_value}'},
                    {'action': 'click', 'target': 'Save and calculate'},
                    {'action': 'wait', 'seconds': 3},
                ]
            }
        }
        for name, wf in defaults.items():
            if name not in self.workflows:
                self.workflows[name] = wf

    def get_workflow(self, name: str) -> Optional[dict]:
        return self.workflows.get(name)

    def list_workflows(self) -> list:
        return list(self.workflows.keys())

    async def execute(self, name: str, params: dict = None) -> dict:
        wf = self.get_workflow(name)
        if not wf:
            return {'status': 'error', 'error': f"Workflow '{name}' not found"}
        
        params = params or {}
        results = []
        
        for i, step in enumerate(wf.get('steps', [])):
            action = step.get('action')
            target = step.get('target', '')
            value = step.get('value', '')
            
            # Substitute params
            for k, v in params.items():
                target = target.replace(f'${{{k}}}', str(v))
                value = value.replace(f'${{{k}}}', str(v))
            
            result = {'step': i, 'action': action, 'target': target}
            
            try:
                if action == 'click':
                    if self.action_engine:
                        r = await self.action_engine.execute('click', target)
                        result.update(r)
                elif action == 'type':
                    if self.action_engine:
                        r = await self.action_engine.execute('type', target, value)
                        result.update(r)
                elif action == 'wait':
                    import asyncio
                    await asyncio.sleep(float(step.get('seconds', 2)))
                    result['status'] = 'success'
                elif action == 'select_combobox':
                    if self.action_engine:
                        r = await self.action_engine.execute('select', target)
                        result.update(r)
                else:
                    result['status'] = 'error'
                    result['error'] = f"Unknown action: {action}"
                
                results.append(result)
                
                if result.get('status') == 'error':
                    return {'status': 'error', 'error': f"Step {i} failed: {action}:{target}",
                           'results': results}
                    
            except Exception as e:
                result['status'] = 'error'
                result['error'] = str(e)
                results.append(result)
                return {'status': 'error', 'error': str(e), 'results': results}
        
        return {'status': 'success', 'results': results}
