#!/usr/bin/env python3
"""Rename automation_bridge references to automation-bridge in automation/automation-bridge directory."""

import os
import re
from pathlib import Path

ROOT = Path("/Users/warren/Documents/_HQ_AI/EdgeGDE/automation/automation-bridge")

# Replacement rules - order matters (longer first)
REPLACEMENTS = [
    # File/module references
    ("automation-bridge", "automation-bridge"),
    ("automation-bridge", "automation-bridge"),
    ("ab_action_bridge", "ab_action_bridge"),
    ("ab_action_bridge", "ab_action_bridge"),
    ("automation_bridge_design_mode", "automation_bridge_design_mode"),
    ("ABActionBridge", "ABActionBridge"),
    ("AutomationBridgeResolver", "AutomationBridgeResolver"),
    ("AutomationBridgeDesignMode", "AutomationBridgeDesignMode"),
    ("AutomationBridge", "AutomationBridge"),
    ("automation_bridge", "automation_bridge"),
    # Loggers
    ("'automation_bridge.action_bridge'", "'ab.action_bridge'"),
    ('"automation_bridge.demo"', '"ab.demo"'),
    ('"automation_bridge.design-mode-confirmation"', '"ab.design-mode-confirmation"'),
    ('"automation_bridge.design-mode"', '"ab.design-mode"'),
    ('"automation_bridge.resolver-adapter"', '"ab.resolver-adapter"'),
    # Paths
    ("/automation_bridge-worktrees/", "/ab-worktrees/"),
    ("/automation-bridge-fastpath/", "/ab-resolver-fastpath/"),
    ("/automation_bridge-confirmation-demo", "/ab-confirmation-demo"),
    # Kanban board references
    ("automation_bridge-integration", "ab-integration"),
    # Window/global references
    ("window.automation_bridgeDesignMode", "window.automationBridgeDesignMode"),
    ("window.__automation_bridgeDesignModePick", "window.__abDesignModePick"),
    ("window.__automation_bridgeDesignModeDeliverPick", "window.__abDesignModeDeliverPick"),
    ("window.__automation_bridgeDesignModeRenderConfirmation", "window.__abDesignModeRenderConfirmation"),
    ("automation_bridgeDesignMode.pending", "abDesignMode.pending"),
    ("automation_bridgeDesignMode.active", "abDesignMode.active"),
    ("automation_bridgeDemo.sync", "abDemo.sync"),
    # Headers
    ("x-automation_bridge-bridge-version", "x-automation-bridge-version"),
    # Class names in strings
    ("__automation_bridgeDesignModePickInstalled", "__abDesignModePickInstalled"),
    # Version strings
    ("automation_bridge-capture@", "ab-capture@"),
    ("automation_bridge-", "ab-"),  # generic prefix
]

def replace_in_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    for old, new in REPLACEMENTS:
        content = content.replace(old, new)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Updated: {filepath}")
        return True
    return False

def rename_files():
    """Rename files that have 'automation_bridge' in their name."""
    renames = [
        ("test_ab_action_bridge.py", "test_ab_action_bridge.py"),
        ("ab_action_bridge.py", "ab_action_bridge.py"),
    ]
    for old_name, new_name in renames:
        old_path = ROOT / old_name
        new_path = ROOT / new_name
        if old_path.exists():
            old_path.rename(new_path)
            print(f"Renamed: {old_name} -> {new_name}")

# Process all .py and .md files
files = list(ROOT.glob("*.py")) + list(ROOT.glob("*.md"))
for f in files:
    replace_in_file(f)

# Rename files
rename_files()

print("Done!")