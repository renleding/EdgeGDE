"""Health monitoring for Rhino MCP servers."""

import asyncio
import socket
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import httpx
import structlog

from .exceptions import ConnectionError

logger = structlog.get_logger(__name__)


class HealthStatus(str, Enum):
    """Health status of a server."""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class ServerHealth:
    """Health status for a single server."""
    server_type: str
    status: HealthStatus = HealthStatus.UNKNOWN
    last_check: float = 0
    response_time_ms: float | None = None
    error: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    
    @property
    def is_healthy(self) -> bool:
        return self.status == HealthStatus.HEALTHY
    
    @property
    def is_available(self) -> bool:
        return self.status in (HealthStatus.HEALTHY, HealthStatus.DEGRADED)


@dataclass
class HealthCheckResult:
    """Result of a health check operation."""
    overall_status: HealthStatus
    servers: dict[str, ServerHealth]
    timestamp: float = field(default_factory=time.time)
    
    @property
    def healthy_count(self) -> int:
        return sum(1 for s in self.servers.values() if s.is_healthy)
    
    @property
    def total_count(self) -> int:
        return len(self.servers)


class HealthMonitor:
    """
    Monitors health of Rhino MCP servers via multiple checks:
    1. Raw TCP + JSON-RPC ping (bypasses Hermes gateway)
    2. Hermes gateway tool call
    3. Tool discovery
    """
    
    def __init__(
        self,
        host: str = "100.110.105.101",
        gateway_url: str = "http://localhost:8642",
        timeout: float = 5.0,
    ):
        self.host = host
        self.gateway_url = gateway_url.rstrip("/")
        self.timeout = timeout
        self._health_cache: dict[str, ServerHealth] = {}
        self._http_client: httpx.AsyncClient | None = None
    
    async def __aenter__(self) -> "HealthMonitor":
        self._http_client = httpx.AsyncClient(timeout=httpx.Timeout(self.timeout))
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._http_client:
            await self._http_client.aclose()
    
    async def check_all(self) -> HealthCheckResult:
        """Check all three Rhino MCP servers."""
        servers = {
            "rhino-mcp-main": {"port": 14242, "internal": 4242},
            "rhino-mcp-mod": {"port": 11999, "internal": 1999},
            "rhino-gh-mcp": {"port": 19876, "internal": 9876},
        }
        
        results = {}
        for name, config in servers.items():
            results[name] = await self._check_server(name, config)
        
        # Determine overall status
        healthy = sum(1 for s in results.values() if s.is_healthy)
        if healthy == len(results):
            overall = HealthStatus.HEALTHY
        elif healthy > 0:
            overall = HealthStatus.DEGRADED
        else:
            overall = HealthStatus.UNHEALTHY
        
        self._health_cache = results
        return HealthCheckResult(overall_status=overall, servers=results)
    
    async def _check_server(self, name: str, config: dict) -> ServerHealth:
        """Check a single server via multiple methods."""
        health = ServerHealth(server_type=name)
        start = time.time()
        
        # 1. Raw TCP + JSON-RPC ping (most reliable - bypasses gateway)
        tcp_ok, tcp_error = await self._tcp_ping(config["port"])
        health.details["tcp_ping"] = {"ok": tcp_ok, "error": tcp_error}
        
        if not tcp_ok:
            health.status = HealthStatus.UNHEALTHY
            health.error = f"TCP ping failed: {tcp_error}"
            health.last_check = time.time()
            return health
        
        # 2. Hermes gateway tool call
        gateway_ok, gateway_error = await self._gateway_ping(name)
        health.details["gateway_ping"] = {"ok": gateway_ok, "error": gateway_error}
        
        if not gateway_ok:
            health.status = HealthStatus.DEGRADED
            health.error = f"Gateway ping failed: {gateway_error}"
        else:
            health.status = HealthStatus.HEALTHY
        
        health.response_time_ms = (time.time() - start) * 1000
        health.last_check = time.time()
        return health
    
    async def _tcp_ping(self, port: int) -> tuple[bool, str | None]:
        """Raw TCP JSON-RPC ping to proxy port."""
        try:
            # Use asyncio to avoid blocking
            loop = asyncio.get_event_loop()
            sock = await loop.run_in_executor(
                None,
                lambda: socket.create_connection((self.host, port), timeout=self.timeout)
            )
            sock.settimeout(self.timeout)
            
            # Send JSON-RPC ping
            ping_msg = json.dumps({"jsonrpc": "2.0", "method": "ping", "id": 1}) + "\n"
            await loop.run_in_executor(None, lambda: sock.sendall(ping_msg.encode()))
            
            # Read response
            response = await loop.run_in_executor(None, lambda: sock.recv(4096))
            sock.close()
            
            if response:
                try:
                    data = json.loads(response.decode())
                    # Even error response means dispatcher is alive
                    return True, None
                except json.JSONDecodeError:
                    return True, None  # Got bytes, dispatcher alive
            
            return False, "Empty response"
        except socket.timeout:
            return False, "TCP timeout"
        except ConnectionRefusedError:
            return False, "Connection refused"
        except ConnectionResetError:
            return False, "Connection reset"
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"
    
    async def _gateway_ping(self, server_name: str) -> tuple[bool, str | None]:
        """Ping via Hermes gateway."""
        if not self._http_client:
            return False, "No HTTP client"
        
        try:
            url = f"{self.gateway_url}/mcp/{server_name}/tools/call"
            response = await self._http_client.post(
                url,
                json={"name": "get_document_summary", "arguments": {}},
            )
            
            if response.status_code == 200:
                return True, None
            elif response.status_code == 404:
                return False, f"Server not found in gateway"
            else:
                return False, f"HTTP {response.status_code}"
        except httpx.TimeoutException:
            return False, "Gateway timeout"
        except httpx.RequestError as e:
            return False, f"Request error: {e}"
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"
    
    async def check_tool_discovery(self, server_name: str) -> tuple[bool, list[str] | None, str | None]:
        """Check tool discovery via Hermes gateway."""
        if not self._http_client:
            return False, None, "No HTTP client"
        
        try:
            url = f"{self.gateway_url}/mcp/{server_name}/tools/list"
            response = await self._http_client.get(url, timeout=self.timeout)
            
            if response.status_code == 200:
                data = response.json()
                tools = [t["name"] for t in data.get("tools", [])]
                return True, tools, None
            else:
                return False, None, f"HTTP {response.status_code}"
        except Exception as e:
            return False, None, f"{type(e).__name__}: {e}"
    
    def get_cached_health(self, server_name: str) -> ServerHealth | None:
        """Get cached health status."""
        return self._health_cache.get(server_name)
    
    def is_server_healthy(self, server_name: str) -> bool:
        """Quick check if server is healthy (from cache)."""
        health = self._health_cache.get(server_name)
        return health is not None and health.is_healthy