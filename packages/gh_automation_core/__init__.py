"""gh_automation_core — FRS-012 autonomous Grasshopper generation engine.

Net-new package implementing the Production & Enterprise Readiness Roadmap.
Modules:
  proxy_catalog  — authoritative live Grasshopper component lookup (no hardcoded GUIDs)
  validate       — validate_graph() / repair_graph() self-healing graph audit (pure logic)
  builder        — GH Definition Builder (add_slider/add_component/connect/group/save/validate)
  inspect        — inspect_workspace() + viewport/canvas capture
"""
from .proxy_catalog import ProxyCatalog, AmbiguousProxyError, NotFoundProxyError, load, find, resolve
from .validate import (
    GraphSpec, GraphNode, WireOp, LiveState, LiveNode, LiveWire,
    validate_graph, compute_repair, repair_graph, ValidationReport,
)
from .builder import GHDefinitionBuilder, compile_single_shot
from .inspect import inspect_workspace, capture_viewport, capture_canvas

__all__ = [
    "ProxyCatalog", "AmbiguousProxyError", "NotFoundProxyError", "load", "find", "resolve",
    "GraphSpec", "GraphNode", "WireOp", "LiveState", "LiveNode", "LiveWire",
    "validate_graph", "compute_repair", "repair_graph", "ValidationReport",
    "GHDefinitionBuilder", "compile_single_shot",
    "inspect_workspace", "capture_viewport", "capture_canvas",
]
