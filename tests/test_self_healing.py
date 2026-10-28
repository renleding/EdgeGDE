"""F12-F05.3 self-healing tests (pure logic, offline-verifiable)."""
from gh_automation_core.validate import (
    GraphSpec, GraphNode, WireOp, LiveState, LiveNode, LiveWire,
    validate_graph, compute_repair, repair_graph,
)


def _broken():
    s = GraphSpec()
    s.nodes["x"] = GraphNode("x", "A")
    s.nodes["y"] = GraphNode("y", "B")
    s.edges = [WireOp("x", "O", "y", "I")]
    live = LiveState(nodes={"x": LiveNode("x", "A"), "y": LiveNode("y", "B")}, wires=[])
    return s, live


def test_self_heal_restores_deleted_wire():
    s, live = _broken()
    assert len(validate_graph(s, live).missing_wires) == 1
    plan = repair_graph(s, live, executor=None)
    assert plan["missing_wire_count"] == 1
    assert "_wire(" in plan["ironpython_script"]
    # simulate applying the repair
    live.wires.append(LiveWire("x", "O", "y", "I"))
    assert validate_graph(s, live).ok is True
    assert len(compute_repair(s, live)) == 0  # idempotent


def test_repair_without_executor_is_side_effect_free():
    s, live = _broken()
    plan = repair_graph(s, live, executor=None)
    assert plan["applied"] is False
    assert plan["executor_output"] == ""
    # live state untouched by a plan-only repair
    assert len(live.wires) == 0
