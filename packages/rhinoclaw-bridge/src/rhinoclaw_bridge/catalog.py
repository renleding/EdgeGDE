"""
Dynamic command catalog for RhinoClaw bridge.

Discovers available commands at startup via list_commands() and
provides validation for the generic rhinoclaw_execute tool.
"""

from typing import Set, Dict, Any
from rhinoclaw_client import RhinoClawClient
from .auth import get_auth_token, get_connection_config


class CommandCatalog:
    """
    Manages the dynamic command catalog from RhinoClaw.
    
    On startup, calls list_commands() to populate the catalog.
    Provides O(1) validation for rhinoclaw_execute tool.
    """
    
    def __init__(self, client: RhinoClawClient):
        self.client = client
        self._commands: Set[str] = set()
        self._catalog_data: Dict[str, Any] = {}
        self._initialized = False
    
    async def initialize(self) -> Dict[str, Any]:
        """
        Initialize catalog by calling list_commands().
        
        Returns:
            Full catalog response from RhinoClaw
        """
        if self._initialized:
            return self._catalog_data
        
        # Call list_commands to get the catalog (sync method)
        result = self.client.send_command("list_commands", {})
        
        # Extract commands list from result
        if isinstance(result, dict):
            commands = result.get("commands", [])
            self._catalog_data = result
        else:
            # Fallback if result structure is different
            commands = []
            self._catalog_data = {"commands": []}
        
        self._commands = set(commands)
        self._initialized = True
        
        return self._catalog_data
    
    def is_valid_command(self, command_type: str) -> bool:
        """Check if a command type exists in the catalog (O(1) lookup)."""
        return command_type in self._commands
    
    def get_commands(self) -> Set[str]:
        """Get all available command types."""
        return self._commands.copy()
    
    def get_catalog_data(self) -> Dict[str, Any]:
        """Get full catalog response including metadata."""
        return self._catalog_data.copy()
    
    def get_command_count(self) -> int:
        """Get number of available commands."""
        return len(self._commands)
    
    @property
    def initialized(self) -> bool:
        return self._initialized


async def create_catalog() -> CommandCatalog:
    """
    Factory function to create and initialize a CommandCatalog.
    
    Creates RhinoClawClient, connects, runs preflight, then initializes catalog.
    """
    config = get_connection_config()
    token = get_auth_token()
    
    client = RhinoClawClient(
        host=config["host"],
        port=config["port"],
        auth_token=token,
        command_timeout=config["timeout"],
    )
    
    # Connect and verify
    client.connect()
    
    # Preflight health check
    health = client.preflight()
    if health.get("auth") != "ready":
        raise RuntimeError(f"RhinoClaw preflight failed: {health}")
    
    # Create and initialize catalog
    catalog = CommandCatalog(client)
    await catalog.initialize()
    
    return catalog