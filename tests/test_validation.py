"""F12-F02 graph validation tests (pure logic, offline-verifiable)."""
from gh_automation_core.validate import (
    GraphSpec, GraphNode, WireOp, LiveState, LiveNode, LiveWire,
    validate_graph, compute_repair, repair_graph,
)


def _spec():
    s = GraphSpec()
    s.nodes["a"] = GraphNode("a", "Height", category="Params")
    s.nodes["b"] = GraphNode("b", "Circle", category="Curve")
    s.nodes["c"] = GraphNode("c", "Extrude", category="Surface")
    s.edges = [WireOp("a", "Slider", "b", "Radius"), WireOp("b", "Circle", "c", "Base")]
    return s


def _live_ok():
    return LiveState(
        nodes={"a": LiveNode("a", "Height"), "b": LiveNode("b", "Circle"),
               "c": LiveNode("c", "Extrude")},
        wires=[LiveWire("a", "Slider", "b", "Radius"), LiveWire("b", "Circle", "c", "Base")])


def test_conforming_graph_validates_ok():
    assert validate_graph(_spec(), _live_ok()).ok is True


def test_missing_wire_detected():
    live = _live_ok()
    live.wires = [live.wires[0]]  # drop the second wire
    rep = validate_graph(_spec(), live)
    assert rep.ok is False
    assert len(rep.missing_wires) == 1
    assert rep.missing_wires[0].dst_node == "c"


def test_red_component_detected():
    live = _live_ok()
    live.nodes["b"] = LiveNode("b", "Circle", error=True, error_msg="collection failed")
    rep = validate_graph(_spec(), live)
    assert any(i.kind == "red_component" for i in rep.issues)


def test_repair_emits_script_and_is_idempotent():
    live = _live_ok()
    live.wires = [live.wires[0]]
    ops = compute_repair(_spec(), live)
    assert len(ops) == 1 and ops[0].dst_node == "c"
    plan = repair_graph(_spec(), live, executor=None)
    assert plan["missing_wire_count"] == 1
    assert plan["ironpython_script"].startswith("import Grasshopper as gh")
    # apply the wire -> re-validate ok -> second repair emits zero ops
    live.wires.append(LiveWire("b", "Circle", "c", "Base"))
    assert validate_graph(_spec(), live).ok is True
    assert len(compute_repair(_spec(), live)) == 0
