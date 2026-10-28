"""
MCP tool definitions for RhinoClaw bridge.

Exposes 7 tools: 1 generic + 6 convenience.
All delegate to RhinoClawClient.send_command() (synchronous).
"""

from typing import Any, Dict, List, Optional
from mcp.server.fastmcp import FastMCP


# ============================================================
# Tool Registration
# ============================================================

def register_tools(mcp: FastMCP, catalog, client) -> None:
    """
    Register all 7 MCP tools with the FastMCP server.
    
    All tools delegate to client.send_command(command_type, params).
    RhinoClawClient.send_command is SYNCHRONOUS.
    """
    
    # ----------------------------------------------------------------
    # GENERIC TOOL: rhinoclaw_execute
    # ----------------------------------------------------------------
    @mcp.tool(
        name="rhinoclaw_execute",
        description="Execute any RhinoClaw TCP command by type. Use for commands not covered by convenience tools."
    )
    def rhinoclaw_execute(command_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute any RhinoClaw command by type."""
        # Validate against catalog
        if not catalog.is_valid_command(command_type):
            available = sorted(catalog.get_commands())
            return {
                "success": False,
                "error": f"Unknown command: '{command_type}'",
                "available_commands": available[:20],  # First 20 for brevity
                "total_commands": len(available)
            }
        
        try:
            result = client.send_command(command_type, params)
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ----------------------------------------------------------------
    # CONVENIENCE TOOL: scene_summary
    # ----------------------------------------------------------------
    @mcp.tool(
        name="scene_summary",
        description="Get complete scene summary: object counts, layers, materials, bounding box"
    )
    def scene_summary() -> Dict[str, Any]:
        """Get complete scene summary."""
        try:
            result = client.send_command("scene_summary", {})
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ----------------------------------------------------------------
    # CONVENIENCE TOOL: create_object
    # ----------------------------------------------------------------
    @mcp.tool(
        name="create_object",
        description="Create a single geometric object (POINT, LINE, CIRCLE, BOX, SPHERE, CYLINDER, etc.)"
    )
    def create_object(type: str, params: Dict[str, Any], layer: Optional[str] = None, name: Optional[str] = None) -> Dict[str, Any]:
        """Create a geometric object."""
        cmd_params = {"type": type, "params": params}
        if layer:
            cmd_params["layer"] = layer
        if name:
            cmd_params["name"] = name
        
        try:
            result = client.send_command("create_object", cmd_params)
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ----------------------------------------------------------------
    # CONVENIENCE TOOL: batch_operations
    # ----------------------------------------------------------------
    @mcp.tool(
        name="batch_operations",
        description="Execute multiple operations atomically with rollback/abort on error"
    )
    def batch_operations(name: str, steps: List[Dict[str, Any]], on_error: str = "rollback") -> Dict[str, Any]:
        """Execute multiple operations atomically."""
        try:
            result = client.send_command("batch_operations", {
                "name": name,
                "steps": steps,
                "on_error": on_error
            })
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ----------------------------------------------------------------
    # CONVENIENCE TOOL: execute_python3_code
    # ----------------------------------------------------------------
    @mcp.tool(
        name="execute_python3_code",
        description="Execute Python 3 (CPython) code in Rhino for RhinoCommon access"
    )
    def execute_python3_code(code: str, timeout: int = 120) -> Dict[str, Any]:
        """Execute Python 3 code in Rhino."""
        try:
            result = client.send_command("execute_python3_code", {"code": code}, timeout=timeout)
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ----------------------------------------------------------------
    # CONVENIENCE TOOL: run_grasshopper
    # ----------------------------------------------------------------
    @mcp.tool(
        name="run_grasshopper",
        description="Run a Grasshopper definition with optional inputs"
    )
    def run_grasshopper(file_path: str, inputs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run a Grasshopper definition."""
        params = {"file_path": file_path}
        if inputs:
            params["inputs"] = inputs
        
        try:
            result = client.send_command("run_grasshopper", params)
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # ----------------------------------------------------------------
    # CONVENIENCE TOOL: bake_grasshopper
    # ----------------------------------------------------------------
    @mcp.tool(
        name="bake_grasshopper",
        description="Bake Grasshopper geometry to Rhino document"
    )
    def bake_grasshopper(file_path: str, layer: Optional[str] = None) -> Dict[str, Any]:
        """Bake Grasshopper geometry to Rhino."""
        params = {"file_path": file_path}
        if layer:
            params["layer"] = layer
        
        try:
            result = client.send_command("bake_grasshopper", params)
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}