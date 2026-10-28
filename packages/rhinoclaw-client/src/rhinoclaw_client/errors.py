"""
RhinoClaw Client Exceptions
"""

class RhinoClawError(Exception):
    """Base exception for RhinoClaw client errors."""
    pass


class AuthError(RhinoClawError):
    """Authentication failed - token missing, invalid, or blocked."""
    
    def __init__(self, message: str, error_code: str = None, blocked_until: float = None):
        super().__init__(message)
        self.error_code = error_code
        self.blocked_until = blocked_until


class CommandError(RhinoClawError):
    """Command execution failed on Rhino side."""
    
    def __init__(self, message: str, error_code: str = None, result: dict = None):
        super().__init__(message)
        self.error_code = error_code
        self.result = result


class ConnectionError(RhinoClawError):
    """TCP connection failed."""
    
    def __init__(self, message: str, host: str = None, port: int = None):
        super().__init__(message)
        self.host = host
        self.port = port


class FramingError(RhinoClawError):
    """Length-prefixed framing error."""
    pass


class TimeoutError(RhinoClawError):
    """Command timeout."""
    pass


class RequestIdMismatchError(RhinoClawError):
    """Response request_id doesn't match sent request_id."""
    pass