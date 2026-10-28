"""
rhinoclaw-bridge: Thin MCP↔TCP bridge for RhinoClaw

Exposes RhinoClaw's 128 TCP commands to Hermes via MCP stdio.
Dynamic command discovery via list_commands() at startup.
"""

from .server import main

__all__ = ["main"]