"""Core MCP client for Rhino/Grasshopper communication."""

import asyncio
import json
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from uuid import uuid4

import httpx
import structlog
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .exceptions import (
    AuthenticationError,
    ConnectionError,
    PluginConflictError,
    ToolNotFoundError,
)

logger = structlog.get_logger(__name__)


class ServerType(str, Enum):
    """Rhino MCP server types."""

    MAIN = "rhino-mcp-main"  # Core modeling + full GH canvas (port 14242)
    MOD = "rhino-mcp-mod"  # Engineering/analysis (port 11999)
    GH = "rhino-gh-mcp"  # Dedicated GH canvas session (port 19876)


@dataclass
class ConnectionConfig:
    """Configuration for a single MCP server connection."""

    server_type: ServerType
    host: str = "100.110.105.101"  # pc2 Tailscale IP
    port: int = 14242  # Proxy port (netsh portproxy)
    timeout: float = 30.0
    allow_remote: bool = True
    auth_key: str | None = None  # Required for rhinomcp-mod
    validate: str = "warn"  # "warn" | "strict" | "off"

    # Internal: actual internal port on pc2 (for diagnostics)
    internal_port: int | None = None

    def __post_init__(self):
        # Map server type to default proxy port
        port_map = {
            ServerType.MAIN: 14242,
            ServerType.MOD: 11999,
            ServerType.GH: 19876,
        }
        internal_map = {
            ServerType.MAIN: 4242,
            ServerType.MOD: 1999,
            ServerType.GH: 9876,
        }
        if self.port == 14242:  # Default not overridden
            self.port = port_map[self.server_type]
        if self.internal_port is None:
            self.internal_port = internal_map[self.server_type]

    @property
    def endpoint(self) -> str:
        return f"tcp://{self.host}:{self.port}"

    @property
    def internal_endpoint(self) -> str:
        return f"tcp://127.0.0.1:{self.internal_port}"


@dataclass
class ToolInfo:
    """Information about an available MCP tool."""

    name: str
    description: str
    input_schema: dict[str, Any]
    server_type: ServerType


class RhinoMCPClient:
    """
    High-level client for communicating with Rhino MCP servers.

    Uses the Hermes gateway's stdio-launched MCP servers which connect via
    netsh port proxies to the Rhino C# plugins on pc2.
    """

    def __init__(
        self,
        configs: dict[ServerType, ConnectionConfig] | None = None,
        gateway_url: str = "http://localhost:8642",
    ):
        self.configs = configs or self._default_configs()
        self.gateway_url = gateway_url.rstrip("/")
        self._tool_cache: dict[ServerType, list[ToolInfo]] = {}
        self._http_client: httpx.AsyncClient | None = None
        self._connected_servers: set[ServerType] = set()

    def _default_configs(self) -> dict[ServerType, ConnectionConfig]:
        """Default connection configurations for the three Rhino MCP servers."""
        return {
            ServerType.MAIN: ConnectionConfig(
                server_type=ServerType.MAIN,
                host="100.110.105.101",
                port=14242,
                timeout=30.0,
                allow_remote=True,
            ),
            ServerType.MOD: ConnectionConfig(
                server_type=ServerType.MOD,
                host="100.110.105.101",
                port=11999,
                timeout=30.0,
                allow_remote=True,
                auth_key=os.getenv("RHINO_MCP_MOD_KEY"),  # Set in environment
            ),
            ServerType.GH: ConnectionConfig(
                server_type=ServerType.GH,
                host="100.110.105.101",
                port=19876,
                timeout=30.0,
                allow_remote=True,
            ),
        }

    async def __aenter__(self) -> "RhinoMCPClient":
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.disconnect()

    async def connect(self) -> None:
        """Establish connections to all configured servers via Hermes gateway."""
        self._http_client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))

        for server_type, config in self.configs.items():
            try:
                await self._verify_server(server_type, config)
                self._connected_servers.add(server_type)
                logger.info("Connected to Rhino MCP server", server=server_type.value, endpoint=config.endpoint)
            except Exception as e:
                logger.warning("Failed to connect to server", server=server_type.value, error=str(e))
                # Don't raise - allow partial connectivity

        if not self._connected_servers:
            raise ConnectionError("No Rhino MCP servers available", original_error=Exception("All servers failed"))

    async def disconnect(self) -> None:
        """Close all connections."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        self._connected_servers.clear()
        self._tool_cache.clear()

    async def _verify_server(self, server_type: ServerType, config: ConnectionConfig) -> None:
        """Verify a server is reachable via Hermes gateway."""
        # The Hermes gateway exposes MCP tools via HTTP at /mcp/{server_name}/tools/call
        url = f"{self.gateway_url}/mcp/{server_type.value}/tools/call"
        payload = {"name": "ping", "arguments": {}}

        try:
            response = await self._http_client.post(url, json=payload)
            if response.status_code == 404:
                raise ConnectionError(
                    f"Server {server_type.value} not found in Hermes gateway",
                    server=server_type.value,
                    endpoint=config.endpoint,
                )
            elif response.status_code == 401:
                raise AuthenticationError(f"Authentication required for {server_type.value}", server_type.value)
            # Any other response (including 500/503) means server exists but may have issues
            # We'll verify properly with tool discovery
        except httpx.RequestError as e:
            raise ConnectionError(
                f"Cannot reach Hermes gateway for {server_type.value}",
                server=server_type.value,
                endpoint=config.endpoint,
                original_error=e,
            )

    @retry(
        retry=retry_if_exception_type((ConnectionError, ToolNotFoundError)),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        stop=stop_after_attempt(3),
    )
    async def call_tool(
        self,
        server_type: ServerType,
        tool_name: str,
        arguments: dict[str, Any],
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """
        Call a tool on a specific Rhino MCP server.

        Args:
            server_type: Which server to call (MAIN, MOD, GH)
            tool_name: Name of the MCP tool
            arguments: Tool arguments
            timeout: Override default timeout

        Returns:
            Tool result as dict

        Raises:
            ToolNotFoundError: If tool doesn't exist on server
            ConnectionError: If server unreachable
            AuthenticationError: If auth fails (mod server)
        """
        if server_type not in self._connected_servers:
            raise ConnectionError(f"Server {server_type.value} not connected", server=server_type.value)

        config = self.configs[server_type]
        url = f"{self.gateway_url}/mcp/{server_type.value}/tools/call"

        # Add auth key for mod server
        if server_type == ServerType.MOD and config.auth_key:
            arguments = {**arguments, "key": config.auth_key}

        payload = {"name": tool_name, "arguments": arguments}

        try:
            response = await self._http_client.post(
                url,
                json=payload,
                timeout=httpx.Timeout(timeout or config.timeout),
            )

            if response.status_code == 404:
                # Tool not found - refresh cache and retry once
                await self.discover_tools(server_type, force=True)
                available = [t.name for t in self._tool_cache.get(server_type, [])]
                raise ToolNotFoundError(tool_name, server_type.value, available)

            if response.status_code == 401:
                raise AuthenticationError(f"Auth failed for {server_type.value}", server_type.value)

            if response.status_code >= 500:
                raise ConnectionError(
                    f"Server error: {response.status_code}",
                    server=server_type.value,
                    endpoint=config.endpoint,
                )

            result = response.json()

            # Check for MCP error responses
            if isinstance(result, dict) and result.get("isError"):
                error_msg = result.get("content", [{}])[0].get("text", "Unknown error")
                if "Value cannot be null. (Parameter 'key')" in error_msg:
                    raise AuthenticationError(f"Missing auth key for {server_type.value}", server_type.value)
                raise RhinoMCPError(f"Tool error: {error_msg}", server=server_type.value)

            return result

        except httpx.TimeoutException as e:
            raise ConnectionError(
                f"Tool call timed out after {timeout or config.timeout}s",
                server=server_type.value,
                endpoint=config.endpoint,
                original_error=e,
            )
        except httpx.RequestError as e:
            raise ConnectionError(
                f"Request failed: {e}",
                server=server_type.value,
                endpoint=config.endpoint,
                original_error=e,
            )

    async def discover_tools(self, server_type: ServerType, force: bool = False) -> list[ToolInfo]:
        """Discover available tools on a server."""
        if server_type in self._tool_cache and not force:
            return self._tool_cache[server_type]

        url = f"{self.gateway_url}/mcp/{server_type.value}/tools/list"

        try:
            response = await self._http_client.get(url, timeout=httpx.Timeout(10.0))
            response.raise_for_status()
            data = response.json()

            tools = []
            for tool_data in data.get("tools", []):
                tools.append(
                    ToolInfo(
                        name=tool_data["name"],
                        description=tool_data.get("description", ""),
                        input_schema=tool_data.get("inputSchema", {}),
                        server_type=server_type,
                    )
                )

            self._tool_cache[server_type] = tools
            logger.info("Discovered tools", server=server_type.value, count=len(tools))
            return tools

        except httpx.RequestError as e:
            raise ConnectionError(
                f"Failed to discover tools: {e}",
                server=server_type.value,
                original_error=e,
            )

    async def get_available_tools(self, server_type: ServerType) -> list[str]:
        """Get list of available tool names for a server."""
        tools = await self.discover_tools(server_type)
        return [t.name for t in tools]

    def is_connected(self, server_type: ServerType) -> bool:
        """Check if a server is connected."""
        return server_type in self._connected_servers

    def get_connected_servers(self) -> list[ServerType]:
        """Get list of currently connected servers."""
        return list(self._connected_servers)

    # Convenience methods for common operations

    async def get_document_summary(self) -> dict[str, Any]:
        """Get document summary from main server."""
        return await self.call_tool(ServerType.MAIN, "get_document_summary", {})

    async def create_objects(self, objects: list[dict[str, Any]]) -> dict[str, Any]:
        """Create objects via RhinoCommon (main server)."""
        return await self.call_tool(ServerType.MAIN, "create_objects", {"objects": objects})

    async def run_command(self, command: str) -> dict[str, Any]:
        """Run a Rhino command (main server)."""
        return await self.call_tool(ServerType.MAIN, "run_command", {"command": command})

    # Grasshopper methods (MAIN and GH servers)

    async def gh_build_graph(
        self,
        graph_id: str,
        components: list[dict[str, Any]],
        wires: list[dict[str, Any]],
        groups: list[dict[str, Any]] | None = None,
        layout: dict[str, Any] | None = None,
        preview_policy: str = "default",
    ) -> dict[str, Any]:
        """
        Build a complete Grasshopper definition in one batched call.

        This is the PRIMARY method for parametric GH authoring.
        """
        args = {
            "graph_id": graph_id,
            "components": components,
            "wires": wires,
            "groups": groups or [],
            "preview_policy": preview_policy,
        }
        if layout:
            args["layout"] = layout

        return await self.call_tool(ServerType.MAIN, "gh_build_graph", args)

    async def gh_mutate_graph(
        self,
        graph_id: str,
        edits: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Mutate an existing Grasshopper graph (rollback-safe)."""
        return await self.call_tool(ServerType.MAIN, "gh_mutate_graph", {"graph_id": graph_id, "edits": edits})

    async def gh_set_parameter_value(self, graph_id: str, param_id: str, value: Any) -> dict[str, Any]:
        """Set a GH parameter/slider value."""
        return await self.call_tool(
            ServerType.MAIN,
            "gh_set_parameter_value",
            {"graph_id": graph_id, "param_id": param_id, "value": value},
        )

    async def gh_get_parameter_value(self, graph_id: str, param_id: str) -> dict[str, Any]:
        """Get a GH parameter/slider value."""
        return await self.call_tool(
            ServerType.MAIN,
            "gh_get_parameter_value",
            {"graph_id": graph_id, "param_id": param_id},
        )

    async def gh_run_solution(self, graph_id: str) -> dict[str, Any]:
        """Trigger GH solution recompute."""
        return await self.call_tool(ServerType.MAIN, "gh_run_solution", {"graph_id": graph_id})

    # Engineering methods (MOD server)

    async def evaluate_stability(self) -> dict[str, Any]:
        """Evaluate structural stability (mod server)."""
        return await self.call_tool(ServerType.MOD, "evaluate_stability", {})

    async def get_connectivity_graph(self) -> dict[str, Any]:
        """Get connectivity graph (mod server)."""
        return await self.call_tool(ServerType.MOD, "get_connectivity_graph", {})

    async def assign_mass(self, object_ids: list[str], mass: float) -> dict[str, Any]:
        """Assign mass to objects (mod server)."""
        return await self.call_tool(ServerType.MOD, "assign_mass", {"object_ids": object_ids, "mass": mass})

    async def list_plugins(self) -> dict[str, Any]:
        """List all loaded Rhino plugins (mod server)."""
        return await self.call_tool(ServerType.MOD, "list_plugins", {})

    async def get_rhino_log(self, lines: int = 50) -> dict[str, Any]:
        """Get Rhino command log (mod server)."""
        return await self.call_tool(ServerType.MOD, "get_rhino_log", {"lines": lines})