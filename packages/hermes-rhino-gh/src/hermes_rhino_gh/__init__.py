"""
Hermes ↔ Rhino/Grasshopper MCP Integration
Comprehensive client for parametric CAD automation via MCP.

Current status (2026-10-25):
- rhinomcp-mod (11999) ✅ STABLE - 50 tools
- rhino-mcp-main (14242) ❌ UNSTABLE - connection resets
- rhino-gh-mcp (19876) ❌ UNSTABLE - connection resets
- Native GH IronPython ✅ WORKS - full parametric definitions

Recommended approach:
1. Use mod server for all RhinoCommon geometry operations
2. Use native GH Python scripts for parametric Grasshopper definitions
3. Main/GH MCP servers available when plugin stability improves
"""

from .client import RhinoMCPClient, ConnectionConfig, ServerType
from .gh_builder import (
    GHGraphBuilder,
    GHComponent,
    GHWire,
    GHGroup,
    SliderConfig,
    create_lamp_shade_graph,
    create_simple_vase_graph,
)
from .health import HealthMonitor, HealthStatus
from .exceptions import (
    RhinoMCPError,
    ConnectionError,
    PluginConflictError,
    AuthenticationError,
    ToolNotFoundError,
    VerificationError,
    TimeoutError,
    GraphBuildError,
)

__all__ = [
    "RhinoMCPClient",
    "ConnectionConfig",
    "ServerType",
    "GHGraphBuilder",
    "GHComponent",
    "GHWire",
    "GHGroup",
    "SliderConfig",
    "create_lamp_shade_graph",
    "create_simple_vase_graph",
    "HealthMonitor",
    "HealthStatus",
    "RhinoMCPError",
    "ConnectionError",
    "PluginConflictError",
    "AuthenticationError",
    "ToolNotFoundError",
    "VerificationError",
    "TimeoutError",
    "GraphBuildError",
]

__version__ = "0.1.0"