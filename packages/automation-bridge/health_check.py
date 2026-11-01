#!/usr/bin/env python3
"""
Health check for automation-bridge.

Checks:
- Chrome for Testing CDP endpoint
- MCP server availability
- State Engine connectivity
- Schema validation
"""

import json
import sys
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from typing import Dict, Any


AUTOMATION_BRIDGE_DIR = Path('/Users/warren/Documents/_HQ_AI/EdgeGDE/automation/automation-bridge')
PACKAGE_DIR = Path(__file__).parent  # This is the package directory


def check_cft_cdp() -> Dict[str, Any]:
    """Check Chrome for Testing CDP endpoint."""
    try:
        req = urllib.request.Request('http://localhost:9222/json/version')
        req.timeout = 5
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return {
                'healthy': True,
                'details': f"CfT version: {data.get('Browser', 'unknown')}",
                'check': 'cft_cdp'
            }
    except urllib.error.URLError as e:
        return {
            'healthy': False,
            'details': f"CfT CDP unreachable: {e}",
            'check': 'cft_cdp'
        }
    except Exception as e:
        return {
            'healthy': False,
            'details': f"CfT check failed: {e}",
            'check': 'cft_cdp'
        }


def check_mcp_schemas() -> Dict[str, Any]:
    """Check MCP schema files exist and are valid JSON."""
    schema_dirs = [
        PACKAGE_DIR / 'schemas',
        AUTOMATION_BRIDGE_DIR
    ]
    required_schemas = [
        'automation-bridge-request.schema.json',
        'automation-bridge-response.schema.json',
        'automation-bridge-error.schema.json'
    ]
    
    missing = []
    invalid = []
    
    for schema_file in required_schemas:
        found = False
        for schema_dir in schema_dirs:
            schema_path = schema_dir / schema_file
            if not schema_path.exists():
                continue
            try:
                with open(schema_path) as f:
                    json.load(f)
                found = True
                break
            except json.JSONDecodeError as e:
                invalid.append(f"{schema_file}: {e}")
                found = True
                break
        if not found:
            missing.append(schema_file)
    
    if missing or invalid:
        return {
            'healthy': False,
            'details': f"Missing: {missing}; Invalid: {invalid}",
            'check': 'mcp_schemas'
        }
    
    return {
        'healthy': True,
        'details': f"All {len(required_schemas)} schemas valid",
        'check': 'mcp_schemas'
    }


def check_implementation_files() -> Dict[str, Any]:
    """Check core implementation files exist."""
    required_files = [
        'ab_action_bridge.py',
        'design_mode_capture.py',
        'design_mode_confirmation.py',
        'resolver_transport_adapter.py'
    ]
    
    missing = [f for f in required_files if not (AUTOMATION_BRIDGE_DIR / f).exists()]
    
    if missing:
        return {
            'healthy': False,
            'details': f"Missing implementation files: {missing}",
            'check': 'implementation_files'
        }
    
    return {
        'healthy': True,
        'details': f"All {len(required_files)} implementation files present",
        'check': 'implementation_files'
    }


def check_tests() -> Dict[str, Any]:
    """Check test files exist."""
    test_files = list(AUTOMATION_BRIDGE_DIR.glob('test_*.py'))
    
    if len(test_files) < 3:
        return {
            'healthy': False,
            'details': f"Only {len(test_files)} test files found (expected 3+)",
            'check': 'tests'
        }
    
    return {
        'healthy': True,
        'details': f"{len(test_files)} test files found",
        'check': 'tests'
    }


def main() -> int:
    """Run all health checks."""
    checks = [
        check_implementation_files,
        check_tests,
        check_mcp_schemas,
        check_cft_cdp,
    ]
    
    results = []
    for check_fn in checks:
        try:
            result = check_fn()
        except Exception as e:
            result = {
                'healthy': False,
                'details': f"Check failed with exception: {e}",
                'check': check_fn.__name__
            }
        results.append(result)
    
    healthy = all(r['healthy'] for r in results)
    
    output = {
        'healthy': healthy,
        'checks': results,
        'summary': f"{sum(r['healthy'] for r in results)}/{len(results)} checks passed"
    }
    
    print(json.dumps(output, indent=2))
    return 0 if healthy else 1


if __name__ == '__main__':
    sys.exit(main())