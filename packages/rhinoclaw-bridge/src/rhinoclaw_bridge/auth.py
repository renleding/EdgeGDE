"""
Authentication token management for RhinoClaw bridge.

Loads token from environment variables with clear precedence.
"""

import os
from typing import Optional


def get_auth_token() -> str:
    """
    Get RhinoClaw auth token from environment.
    
    Precedence:
    1. RHINOCLAW_AUTH_TOKEN (explicit)
    2. RHINOCLAW_AUTH_TOKEN_FILE (path to file containing token)
    
    Raises:
        RuntimeError: If no token found
    """
    # Direct token
    token = os.environ.get("RHINOCLAW_AUTH_TOKEN")
    if token:
        return token.strip()
    
    # Token from file
    token_file = os.environ.get("RHINOCLAW_AUTH_TOKEN_FILE")
    if token_file:
        try:
            with open(token_file, "r") as f:
                return f.read().strip()
        except FileNotFoundError:
            raise RuntimeError(f"Auth token file not found: {token_file}")
        except PermissionError:
            raise RuntimeError(f"Permission denied reading token file: {token_file}")
    
    raise RuntimeError(
        "RhinoClaw auth token not configured. "
        "Set RHINOCLAW_AUTH_TOKEN or RHINOCLAW_AUTH_TOKEN_FILE environment variable."
    )


def get_connection_config() -> dict:
    """Get connection configuration from environment with defaults."""
    return {
        "host": os.environ.get("RHINOCLAW_HOST", "127.0.0.1"),
        "port": int(os.environ.get("RHINOCLAW_PORT", "1999")),
        "timeout": float(os.environ.get("RHINOCLAW_TIMEOUT", "30")),
        "debug": os.environ.get("RHINOCLAW_DEBUG", "false").lower() in ("1", "true", "yes", "on"),
    }