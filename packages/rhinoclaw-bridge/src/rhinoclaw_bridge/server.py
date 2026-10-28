"""
rhinoclaw-bridge: Thin MCP↔TCP bridge for RhinoClaw.

FastMCP stdio server exposing 7 tools:
- 1 generic: rhinoclaw_execute (validates against dynamic catalog)
- 6 convenience: scene_summary, create_object, batch_operations, execute_python3_code, run_grasshopper, bake_grasshopper

All tools delegate to RhinoClawClient.execute().
Dynamic command catalog discovered at startup via list_commands().
"""

import asyncio
import os
import sys
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP

from .auth import get_connection_config, get_auth_token
from .catalog import create_catalog
from .tools import register_tools
from rhinoclaw_client import RhinoClawClient


# Global state
_client: RhinoClawClient = None
_catalog = None
_mcp: FastMCP = None


@asynccontextmanager
async def lifespan(server: FastMCP):
    """Manage server startup and shutdown lifecycle."""
    global _client, _catalog, _mcp
    
    # Startup
    print("Starting rhinoclaw-bridge...", file=sys.stderr)
    
    config = get_connection_config()
    token = get_auth_token()
    
    print(f"Connecting to RhinoClaw at {config['host']}:{config['port']}", file=sys.stderr)
    
    _client = RhinoClawClient(
        host=config["host"],
        port=config["port"],
        auth_token=token,
        command_timeout=config["timeout"],
    )
    
    # Connect
    _client.connect()
    print("TCP connection established", file=sys.stderr)
    
    # Preflight health check
    health = _client.preflight()
    if health.get("auth") != "ready":
        raise RuntimeError(f"RhinoClaw preflight failed: {health}")
    print(f"Preflight OK: plugin v{health.get('plugin_version', 'unknown')}, GH: {health.get('gh_available', False)}", file=sys.stderr)
    
    # Initialize dynamic command catalog
    _catalog = await create_catalog()
    print(f"Command catalog loaded: {_catalog.get_command_count()} commands", file=sys.stderr)
    
    # Register tools with catalog and client
    register_tools(_mcp, _catalog, _client)
    print("MCP tools registered (1 generic + 6 convenience)", file=sys.stderr)
    
    print("rhinoclaw-bridge ready", file=sys.stderr)
    
    try:
        yield {}
    finally:
        # Shutdown
        print("Shutting down rhinoclaw-bridge...", file=sys.stderr)
        if _client:
            _client.disconnect()
        print("Disconnected", file=sys.stderr)


def create_server() -> FastMCP:
    """Create and configure the FastMCP server."""
    global _mcp
    
    _mcp = FastMCP(
        "rhinoclaw-bridge",
        lifespan=lifespan,
    )
    
    return _mcp


def main():
    """Entry point for uvx rhinoclaw-bridge."""
    server = create_server()
    server.run()


if __name__ == "__main__":
    main()