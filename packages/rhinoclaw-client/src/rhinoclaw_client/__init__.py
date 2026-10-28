"""
RhinoClaw Python Client Library

Standalone client for RhinoClaw TCP protocol (port 1999).
Handles length-prefixed JSON framing, auth, request/response matching.

Usage:
    client = RhinoClawClient(
        host="100.110.105.101",
        port=1999,
        auth_token=os.environ["RHINOCLAW_AUTH_TOKEN"]
    )
    client.hello()
    client.ping()
    client.scene_summary()
    client.build_and_bake_recipe("box", params={"x": 40, "y": 20, "z": 10})
"""

from .client import RhinoClawClient
from .errors import RhinoClawError, AuthError, CommandError, ConnectionError

__all__ = [
    "RhinoClawClient",
    "RhinoClawError",
    "AuthError", 
    "CommandError",
    "ConnectionError",
]