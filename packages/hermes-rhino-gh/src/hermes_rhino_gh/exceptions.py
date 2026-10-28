"""Custom exceptions for Hermes-Rhino-GH integration."""


class RhinoMCPError(Exception):
    """Base exception for all Rhino MCP errors."""

    def __init__(self, message: str, server: str | None = None, details: dict | None = None):
        super().__init__(message)
        self.server = server
        self.details = details or {}


class ConnectionError(RhinoMCPError):
    """Raised when connection to Rhino MCP server fails."""

    def __init__(
        self,
        message: str,
        server: str | None = None,
        endpoint: str | None = None,
        original_error: Exception | None = None,
    ):
        super().__init__(message, server, {"endpoint": endpoint})
        self.endpoint = endpoint
        self.original_error = original_error


class PluginConflictError(RhinoMCPError):
    """Raised when multiple Rhino MCP plugins are loaded causing conflicts."""

    def __init__(self, message: str, conflicting_ports: list[int] | None = None):
        super().__init__(message, details={"conflicting_ports": conflicting_ports or []})
        self.conflicting_ports = conflicting_ports or []


class AuthenticationError(RhinoMCPError):
    """Raised when authentication fails (e.g., missing key for rhinomcp-mod)."""

    def __init__(self, message: str, server: str | None = None):
        super().__init__(message, server)


class ToolNotFoundError(RhinoMCPError):
    """Raised when a requested tool is not available on the server."""

    def __init__(self, tool_name: str, server: str, available_tools: list[str] | None = None):
        super().__init__(
            f"Tool '{tool_name}' not found on server '{server}'",
            server,
            {"available_tools": available_tools or []},
        )
        self.tool_name = tool_name
        self.available_tools = available_tools or []


class VerificationError(RhinoMCPError):
    """Raised when post-operation verification fails."""

    def __init__(
        self,
        message: str,
        operation: str,
        expected: dict | None = None,
        actual: dict | None = None,
    ):
        super().__init__(message, details={"operation": operation, "expected": expected, "actual": actual})
        self.operation = operation
        self.expected = expected
        self.actual = actual


class TimeoutError(RhinoMCPError):
    """Raised when an operation times out."""

    def __init__(self, message: str, operation: str, timeout_seconds: float):
        super().__init__(message, details={"operation": operation, "timeout_seconds": timeout_seconds})
        self.operation = operation
        self.timeout_seconds = timeout_seconds


class GraphBuildError(RhinoMCPError):
    """Raised when gh_build_graph fails."""

    def __init__(
        self,
        message: str,
        graph_id: str,
        stage: str,
        details: dict | None = None,
    ):
        super().__init__(message, details={"graph_id": graph_id, "stage": stage, **(details or {})})
        self.graph_id = graph_id
        self.stage = stage