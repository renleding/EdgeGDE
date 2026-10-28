"""
RhinoClaw TCP Client

Implements the RhinoClaw wire protocol:
- Length-prefixed JSON frames (4-byte big-endian)
- Auth token injection
- Request/response matching via request_id
- Idempotency keys for retry safety
"""

import json
import socket
import struct
import uuid
import time
import os
from typing import Any, Dict, Optional, List, Union
from contextlib import contextmanager

from .errors import (
    RhinoClawError,
    AuthError,
    CommandError,
    ConnectionError,
    FramingError,
    TimeoutError,
    RequestIdMismatchError,
)


MAX_FRAME_BYTES = 32 * 1024 * 1024  # 32 MB
DEFAULT_TIMEOUT = 30.0
DEFAULT_CONNECT_TIMEOUT = 5.0


def _new_request_id() -> str:
    """Generate 8-char hex request ID."""
    return uuid.uuid4().hex[:8]


def _new_idempotency_key() -> str:
    """Generate 32-char hex idempotency key."""
    return uuid.uuid4().hex


def _build_command(
    command_type: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    request_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    auth_token: Optional[str] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Build a RhinoClaw command frame."""
    command: Dict[str, Any] = {
        "type": command_type,
        "params": params or {},
    }
    if request_id is not None:
        command["request_id"] = request_id
    if idempotency_key is not None:
        command["idempotency_key"] = idempotency_key
    if auth_token:
        command["auth"] = auth_token
    if timeout is not None:
        command["timeout"] = timeout
    return command


def _encode_command(command: Dict[str, Any], *, framed: bool = True) -> bytes:
    """Serialize command to wire format (length-prefixed JSON)."""
    payload = json.dumps(command, allow_nan=False).encode("utf-8")
    if len(payload) > MAX_FRAME_BYTES:
        raise ValueError(f"Command exceeds maximum frame size ({MAX_FRAME_BYTES} bytes)")
    if framed:
        return struct.pack("!I", len(payload)) + payload
    return payload


def _read_json_frame(
    sock: socket.socket,
    *,
    framed: bool = True,
    max_frame_bytes: int = MAX_FRAME_BYTES,
    deadline: Optional[float] = None,
) -> bytes:
    """Read one complete JSON frame from socket."""
    
    def _recv(count: int) -> bytes:
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise socket.timeout("response deadline exceeded")
            sock.settimeout(remaining)
        return sock.recv(count)

    if framed:
        # Read 4-byte length prefix
        length_bytes = b""
        while len(length_bytes) < 4:
            chunk = _recv(4 - len(length_bytes))
            if not chunk:
                raise FramingError("Connection closed while reading frame length")
            length_bytes += chunk
        
        length = struct.unpack("!I", length_bytes)[0]
        if not 0 < length <= max_frame_bytes:
            raise FramingError(f"Invalid response frame length: {length}")
        
        # Read exact payload length
        data = bytearray()
        while len(data) < length:
            chunk = _recv(min(8192, length - len(data)))
            if not chunk:
                raise FramingError("Connection closed while reading frame payload")
            data.extend(chunk)
        
        # Validate JSON
        try:
            json.loads(data.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise FramingError(f"Invalid JSON in response frame: {e}")
        
        return bytes(data)
    
    else:
        # Legacy: accumulate until valid JSON
        chunks = []
        total = 0
        while True:
            try:
                chunk = _recv(8192)
            except socket.timeout:
                break
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > max_frame_bytes:
                raise FramingError("Response exceeds maximum frame size")
        
        data = b"".join(chunks)
        try:
            json.loads(data.decode("utf-8"))
            return data
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise FramingError(f"Incomplete JSON response: {e}")


def _send_command(
    sock: socket.socket,
    command: Dict[str, Any],
    *,
    framed: bool = True,
    deadline: Optional[float] = None,
) -> Dict[str, Any]:
    """Send command and read response."""
    payload = _encode_command(command, framed=framed)
    sock.sendall(payload)
    
    response_bytes = _read_json_frame(sock, framed=framed, deadline=deadline)
    
    # DEBUG
    print(f"DEBUG RAW RESPONSE: {response_bytes[:200]}")
    
    response = json.loads(response_bytes.decode("utf-8"))
    
    # Validate request_id match
    sent_id = command.get("request_id")
    echoed_id = response.get("request_id")
    if sent_id is not None and echoed_id is not None and echoed_id != sent_id:
        raise RequestIdMismatchError(
            f"Request ID mismatch: sent {sent_id}, got {echoed_id}"
        )
    
    return response


class RhinoClawClient:
    """
    RhinoClaw TCP Client
    
    Handles connection lifecycle, auth, framing, and command execution.
    
    Example:
        client = RhinoClawClient(
            host="100.110.105.101",
            port=1999,
            auth_token=os.environ["RHINOCLAW_AUTH_TOKEN"]
        )
        
        # Health checks
        client.hello()
        client.ping()
        
        # Commands
        client.scene_summary()
        client.create_object("BOX", params={"width": 5, "length": 3, "height": 2.5})
        client.batch_operations([...])
    """
    
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 1999,
        auth_token: Optional[str] = None,
        connect_timeout: float = DEFAULT_CONNECT_TIMEOUT,
        command_timeout: float = DEFAULT_TIMEOUT,
        framed: bool = True,
        auto_reconnect: bool = True,
    ):
        self.host = host
        self.port = port
        self.auth_token = auth_token or os.environ.get("RHINOCLAW_AUTH_TOKEN")
        self.connect_timeout = connect_timeout
        self.command_timeout = command_timeout
        self.framed = framed
        self.auto_reconnect = auto_reconnect
        
        self._sock: Optional[socket.socket] = None
        self._session_id: Optional[str] = None
        self._connected = False
    
    def connect(self) -> bool:
        """Establish TCP connection to RhinoClaw."""
        if self._connected and self._sock:
            return True
        
        try:
            self._sock = socket.create_connection(
                (self.host, self.port),
                timeout=self.connect_timeout
            )
            self._sock.settimeout(self.command_timeout)
            self._connected = True
            self._session_id = None
            return True
        except (socket.timeout, ConnectionRefusedError, OSError) as e:
            self._connected = False
            raise ConnectionError(
                f"Failed to connect to {self.host}:{self.port}: {e}",
                host=self.host,
                port=self.port
            )
    
    def disconnect(self) -> None:
        """Close TCP connection."""
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
            self._sock = None
        self._connected = False
        self._session_id = None
    
    def __enter__(self) -> "RhinoClawClient":
        self.connect()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.disconnect()
    
    @contextmanager
    def _command_context(self, command_type: str, params: Dict[str, Any], **kwargs):
        """Context manager for command execution with auto-reconnect."""
        if not self._connected:
            self.connect()
        
        deadline = time.monotonic() + self.command_timeout
        
        # Generate request tracking - new idempotency key per command (not per session)
        request_id = kwargs.pop("request_id", _new_request_id())
        idempotency_key = kwargs.pop("idempotency_key", _new_idempotency_key())
        
        command = _build_command(
            command_type,
            params=params,
            request_id=request_id,
            idempotency_key=idempotency_key,
            auth_token=self.auth_token,
            timeout=kwargs.pop("timeout", self.command_timeout),
        )
        
        print(f"DEBUG: Sending {command_type}, request_id={request_id}")
        
        try:
            response = _send_command(
                self._sock,
                command,
                framed=self.framed,
                deadline=deadline,
            )
            print(f"DEBUG: Response status={response.get('status')}, result type={type(response.get('result'))}")
            yield response
        except (ConnectionError, socket.timeout, ConnectionResetError, BrokenPipeError) as e:
            if self.auto_reconnect:
                self.disconnect()
                self.connect()
                # Retry once with new connection - use SAME idempotency key for retry
                try:
                    retry_command = _build_command(
                        command_type,
                        params=params,
                        request_id=_new_request_id(),
                        idempotency_key=idempotency_key,  # Same key for retry
                        auth_token=self.auth_token,
                        timeout=kwargs.pop("timeout", self.command_timeout),
                    )
                    response = _send_command(
                        self._sock,
                        retry_command,
                        framed=self.framed,
                        deadline=deadline,
                    )
                    yield response
                    return
                except Exception:
                    raise
            raise ConnectionError(f"Command failed: {e}", host=self.host, port=self.port)
    
    def _execute(self, command_type: str, params: Dict[str, Any], **kwargs) -> Dict[str, Any]:
        """Execute a command and return result."""
        with self._command_context(command_type, params, **kwargs) as response:
            status = response.get("status")
            result = response.get("result")
            
            if status == "error":
                if isinstance(result, dict):
                    error_code = result.get("error_code")
                    message = result.get("message", str(result))
                    blocked_until = result.get("blocked_until")
                else:
                    error_code = None
                    message = str(result)
                    blocked_until = None
                
                if error_code == "AUTH_REQUIRED":
                    raise AuthError(message, error_code=error_code)
                elif error_code == "AUTH_BLOCKED":
                    raise AuthError(message, error_code=error_code, blocked_until=blocked_until)
                elif error_code == "UNKNOWN_COMMAND":
                    raise CommandError(f"Unknown command: {command_type}", error_code=error_code)
                else:
                    raise CommandError(message, error_code=error_code, result=result if isinstance(result, dict) else None)
            
            # Return result dict, or wrap primitive in dict
            if isinstance(result, dict):
                return result
            else:
                return {"value": result}
    
    # ============================================================
    # Health & Discovery
    # ============================================================
    
    def hello(self) -> Dict[str, Any]:
        """
        Auth-free listener check + metadata.
        
        Returns:
            {
                "pong": true,
                "plugin_version": "0.8.2.0",
                "auth_required": true,
                "gh_available": true,
                "framing": ["json", "length_prefix_v1"],
                ...
            }
        """
        return self._execute("hello", {})
    
    def ping(self) -> Dict[str, Any]:
        """
        Authenticated liveness check.
        
        Returns:
            {"status": "success", "message": "Pong", "timestamp": "..."}
        """
        return self._execute("ping", {})
    
    def list_commands(self) -> Dict[str, Any]:
        """
        Get full TCP command catalog (128 commands).
        
        Returns:
            {"command_count": 128, "commands": [...], "mcp_only_note": "..."}
        """
        return self._execute("list_commands", {})
    
    def preflight(self) -> Dict[str, Any]:
        """
        Combined health check: hello -> ping.
        
        Returns:
            {
                "connected": true,
                "auth": "ready" | "missing_token",
                "plugin_version": "0.8.2.0",
                "gh_available": true,
            }
        """
        try:
            h = self.hello()
            p = self.ping()
            return {
                "connected": True,
                "auth": "ready" if p.get("status") == "success" else "missing_token",
                "plugin_version": h.get("plugin_version", "unknown"),
                "gh_available": h.get("gh_available", False),
            }
        except AuthError as e:
            return {
                "connected": True,
                "auth": "missing_token",
                "error": str(e),
            }
        except Exception as e:
            return {
                "connected": False,
                "auth": "error",
                "error": str(e),
            }
    
    # ============================================================
    # Geometry & Objects
    # ============================================================
    
    def create_object(
        self,
        object_type: str,
        params: Dict[str, Any],
        layer: Optional[str] = None,
        name: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Create a single object.
        
        Args:
            object_type: "POINT", "LINE", "CIRCLE", "BOX", "SPHERE", "CYLINDER", etc.
            params: Type-specific parameters (e.g., {"x": 0, "y": 0, "z": 0} for POINT)
            layer: Optional layer name
            name: Optional object name
        
        Returns:
            {"object_id": "guid", "type": "POINT", ...}
        """
        cmd_params = {"type": object_type, "params": params}
        if layer:
            cmd_params["layer"] = layer
        if name:
            cmd_params["name"] = name
        return self._execute("create_object", cmd_params, **kwargs)
    
    def create_objects(
        self,
        objects: List[Dict[str, Any]],
        **kwargs
    ) -> Dict[str, Any]:
        """
        Create multiple objects in one call.
        
        Args:
            objects: List of {"type": "...", "params": {...}, "layer"?, "name"?}
        """
        return self._execute("create_objects", {"objects": objects}, **kwargs)
    
    def modify_object(
        self,
        object_id: str,
        params: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        """Modify a single object."""
        return self._execute("modify_object", {"object_id": object_id, "params": params}, **kwargs)
    
    def modify_objects(
        self,
        modifications: List[Dict[str, Any]],
        **kwargs
    ) -> Dict[str, Any]:
        """Modify multiple objects."""
        return self._execute("modify_objects", {"modifications": modifications}, **kwargs)
    
    def delete_object(self, object_id: str, **kwargs) -> Dict[str, Any]:
        return self._execute("delete_object", {"object_id": object_id}, **kwargs)
    
    def copy_object(
        self,
        object_id: str,
        count: int = 1,
        transform: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"object_id": object_id, "count": count}
        if transform:
            params["transform"] = transform
        return self._execute("copy_object", params, **kwargs)
    
    def mirror_object(
        self,
        object_id: str,
        plane: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("mirror_object", {"object_id": object_id, "plane": plane}, **kwargs)
    
    def move_object(
        self,
        object_id: str,
        vector: Dict[str, float],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("move_object", {"object_id": object_id, "vector": vector}, **kwargs)
    
    def rotate_object(
        self,
        object_id: str,
        center: Dict[str, float],
        angle: float,
        axis: Optional[Dict[str, float]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"object_id": object_id, "center": center, "angle": angle}
        if axis:
            params["axis"] = axis
        return self._execute("rotate_object", params, **kwargs)
    
    def scale_object(
        self,
        object_id: str,
        center: Dict[str, float],
        factor: Union[float, Dict[str, float]],
        **kwargs
    ) -> Dict[str, Any]:
        params = {"object_id": object_id, "center": center, "factor": factor}
        return self._execute("scale_object", params, **kwargs)
    
    def array_linear(
        self,
        object_id: str,
        count: int,
        vector: Dict[str, float],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("array_linear", {"object_id": object_id, "count": count, "vector": vector}, **kwargs)
    
    def array_polar(
        self,
        object_id: str,
        count: int,
        center: Dict[str, float],
        angle: float,
        axis: Optional[Dict[str, float]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"object_id": object_id, "count": count, "center": center, "angle": angle}
        if axis:
            params["axis"] = axis
        return self._execute("array_polar", params, **kwargs)
    
    # ============================================================
    # Booleans
    # ============================================================
    
    def boolean_operation(
        self,
        operation: str,
        primary_id: str,
        secondary_ids: List[str],
        **kwargs
    ) -> Dict[str, Any]:
        """
        Boolean operation.
        
        Args:
            operation: "union", "difference", "intersection"
        """
        return self._execute("boolean_operation", {
            "operation": operation,
            "primary_id": primary_id,
            "secondary_ids": secondary_ids,
        }, **kwargs)
    
    # ============================================================
    # Batch Operations (Atomic with Rollback)
    # ============================================================
    
    def batch_operations(
        self,
        name: str,
        steps: List[Dict[str, Any]],
        on_error: str = "rollback",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Execute multiple operations atomically.
        
        Args:
            name: Batch name for logging
            steps: List of {"tool": "command_name", "args": {...}}
            on_error: "rollback" (undo all) | "abort" (stop, keep completed)
        
        Returns:
            {"results": [...], "status": "success|partial|failed"}
        """
        return self._execute("batch_operations", {
            "name": name,
            "steps": steps,
            "on_error": on_error,
        }, **kwargs)
    
    # ============================================================
    # Layers & Materials
    # ============================================================
    
    def create_layer(
        self,
        name: str,
        color: Optional[List[int]] = None,
        parent: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"name": name}
        if color:
            params["color"] = color
        if parent:
            params["parent"] = parent
        return self._execute("create_layer", params, **kwargs)
    
    def create_material(
        self,
        name: str,
        color: Optional[List[int]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"name": name}
        if color:
            params["color"] = color
        return self._execute("create_material", params, **kwargs)
    
    def assign_material_to_layer(
        self,
        layer_name: str,
        material_id: str,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("assign_material_to_layer", {
            "layer_name": layer_name,
            "material_id": material_id,
        }, **kwargs)
    
    # ============================================================
    # Selection & Inspection
    # ============================================================
    
    def scene_summary(self, **kwargs) -> Dict[str, Any]:
        """Full scene summary with object counts, layers, etc."""
        return self._execute("scene_summary", {}, **kwargs)
    
    def find_nearby(
        self,
        point: List[float],
        radius: float,
        layer: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"point": point, "radius": radius}
        if layer:
            params["layer"] = layer
        return self._execute("find_nearby", params, **kwargs)
    
    def get_object_info(self, object_id: str, **kwargs) -> Dict[str, Any]:
        return self._execute("get_object_info", {"object_id": object_id}, **kwargs)
    
    def get_objects_info(self, object_ids: List[str], **kwargs) -> Dict[str, Any]:
        return self._execute("get_objects_info", {"object_ids": object_ids}, **kwargs)
    
    def get_relationships(
        self,
        object_id: str,
        touch_tolerance: float = 0.01,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("get_relationships", {
            "object_id": object_id,
            "touch_tolerance": touch_tolerance,
        }, **kwargs)
    
    def find_objects(
        self,
        layer: Optional[str] = None,
        type: Optional[str] = None,
        name: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {}
        if layer:
            params["layer"] = layer
        if type:
            params["type"] = type
        if name:
            params["name"] = name
        return self._execute("find_objects", params, **kwargs)
    
    # ============================================================
    # Grasshopper
    # ============================================================
    
    def inspect_grasshopper_definition(
        self,
        file_path: str,
        only_player_inputs: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """Inspect GH definition to discover inputs/outputs."""
        return self._execute("inspect_grasshopper_definition", {
            "file_path": file_path,
            "only_player_inputs": only_player_inputs,
        }, **kwargs)
    
    def run_grasshopper(
        self,
        file_path: str,
        inputs: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Run a Grasshopper definition."""
        params = {"file_path": file_path}
        if inputs:
            params["inputs"] = inputs
        return self._execute("run_grasshopper", params, **kwargs)
    
    def set_grasshopper_parameter(
        self,
        file_path: str,
        param_name: str,
        value: Any,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("set_grasshopper_parameter", {
            "file_path": file_path,
            "param_name": param_name,
            "value": value,
        }, **kwargs)
    
    def set_grasshopper_parameters(
        self,
        file_path: str,
        parameters: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("set_grasshopper_parameters", {
            "file_path": file_path,
            "parameters": parameters,
        }, **kwargs)
    
    def bake_grasshopper(
        self,
        file_path: str,
        layer: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        params = {"file_path": file_path}
        if layer:
            params["layer"] = layer
        return self._execute("bake_grasshopper", params, **kwargs)
    
    def build_and_bake_recipe(
        self,
        recipe: str,
        params: Optional[Dict[str, Any]] = None,
        layer: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Build and bake a plugin-native parametric recipe.
        
        Args:
            recipe: Recipe name (e.g., "box", or list recipes with "list")
            params: Recipe parameters
            layer: Target layer
        """
        p = {"recipe": recipe}
        if params:
            p["params"] = params
        if layer:
            p["layer"] = layer
        return self._execute("build_and_bake_recipe", p, **kwargs)
    
    def build_gh_definition(
        self,
        components: List[Dict[str, Any]],
        connections: List[Dict[str, Any]],
        **kwargs
    ) -> Dict[str, Any]:
        """Build a GH definition from components + connections."""
        return self._execute("build_gh_definition", {
            "components": components,
            "connections": connections,
        }, **kwargs)
    
    def get_grasshopper_canvas(self, **kwargs) -> Dict[str, Any]:
        return self._execute("get_grasshopper_canvas", {}, **kwargs)
    
    def get_grasshopper_outputs(self, **kwargs) -> Dict[str, Any]:
        return self._execute("get_grasshopper_outputs", {}, **kwargs)
    
    def solve_grasshopper(self, **kwargs) -> Dict[str, Any]:
        return self._execute("solve_grasshopper", {}, **kwargs)
    
    # ============================================================
    # Scripting (Python / RhinoScript)
    # ============================================================
    
    def execute_python3_code(
        self,
        code: str,
        timeout: Optional[float] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Execute Python 3 (CPython) code in Rhino.
        
        Use for RhinoCommon, complex geometry, external libraries.
        
        Args:
            code: Python code string
            timeout: Override default timeout (up to 300s)
        """
        return self._execute("execute_python3_code", {"code": code}, timeout=timeout or 120, **kwargs)
    
    def execute_rhinoscript_python_code(
        self,
        code: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Execute RhinoScript (rhinoscriptsyntax) code.
        
        Friendlier API for common operations.
        """
        return self._execute("execute_rhinoscript_python_code", {"code": code}, **kwargs)
    
    def run_native_command(
        self,
        command: str,
        args: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Run a native Rhino command.
        
        Args:
            command: Command name (e.g., "_Loft", "_Sweep1")
            args: Command line arguments (e.g., ["_Pause", "_Pause", "_Enter"])
        """
        params = {"command": command}
        if args:
            params["args"] = args
        return self._execute("run_native_command", params, **kwargs)
    
    # ============================================================
    # Viewport & Rendering
    # ============================================================
    
    def capture_viewport(
        self,
        width: int = 1920,
        height: int = 1080,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("capture_viewport", {"width": width, "height": height}, **kwargs)
    
    def zoom_extents(self, **kwargs) -> Dict[str, Any]:
        return self._execute("zoom_extents", {}, **kwargs)
    
    def zoom_selected(self, **kwargs) -> Dict[str, Any]:
        return self._execute("zoom_selected", {}, **kwargs)
    
    def set_view(
        self,
        view: str,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("set_view", {"view": view}, **kwargs)
    
    def render_view(
        self,
        width: int = 1920,
        height: int = 1080,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("render_view", {"width": width, "height": height}, **kwargs)
    
    # ============================================================
    # VisualARQ (BIM)
    # ============================================================
    
    def va_create_wall(
        self,
        profile: str,
        path: List[Dict[str, float]],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("va_create_wall", {"profile": profile, "path": path}, **kwargs)
    
    def va_create_slab(
        self,
        boundary: List[Dict[str, float]],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("va_create_slab", {"boundary": boundary}, **kwargs)
    
    def va_create_plan_view(
        self,
        name: str,
        level: str,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("va_create_plan_view", {"name": name, "level": level}, **kwargs)
    
    def va_create_section(
        self,
        name: str,
        plane: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("va_create_section", {"name": name, "plane": plane}, **kwargs)
    
    # ============================================================
    # Document Operations
    # ============================================================
    
    def get_document_info(self, **kwargs) -> Dict[str, Any]:
        return self._execute("get_document_info", {}, **kwargs)
    
    def save_file(self, file_path: str, **kwargs) -> Dict[str, Any]:
        return self._execute("save_file", {"file_path": file_path}, **kwargs)
    
    def open_file(self, file_path: str, **kwargs) -> Dict[str, Any]:
        return self._execute("open_file", {"file_path": file_path}, **kwargs)
    
    def export_file(
        self,
        file_path: str,
        file_type: str,
        **kwargs
    ) -> Dict[str, Any]:
        return self._execute("export_file", {
            "file_path": file_path,
            "file_type": file_type,
        }, **kwargs)
    
    # ============================================================
    # Undo/Redo
    # ============================================================
    
    def undo(self, **kwargs) -> Dict[str, Any]:
        return self._execute("undo", {}, **kwargs)
    
    def redo(self, **kwargs) -> Dict[str, Any]:
        return self._execute("redo", {}, **kwargs)
    
    # ============================================================
    # Debug / Utility
    # ============================================================
    
    def get_logs(self, **kwargs) -> Dict[str, Any]:
        return self._execute("get_logs", {}, **kwargs)
    
    def clear_logs(self, **kwargs) -> Dict[str, Any]:
        return self._execute("clear_logs", {}, **kwargs)
    
    def set_debug_mode(self, enable: bool, **kwargs) -> Dict[str, Any]:
        return self._execute("set_debug_mode", {"enable": enable}, **kwargs)
    
    # ============================================================
    # Generic send_command (for commands not yet wrapped)
    # ============================================================
    
    def send_command(
        self,
        command_type: str,
        params: Dict[str, Any],
        **kwargs
    ) -> Dict[str, Any]:
        """Generic command execution for any TCP command."""
        return self._execute(command_type, params, **kwargs)