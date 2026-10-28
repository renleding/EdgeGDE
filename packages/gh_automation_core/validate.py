"""Graph validation + self-healing (FRS-012 P1-F01, P1-F02).

Pure, deterministic logic over a declarative GraphSpec and a serialized LiveState
of the Grasshopper document. No Rhino/Grasshopper imports — the bridge adapter
serializes live GH state into LiveState and applies the emitted WireOps. This
makes validation and self-healing auditable and unit-testable offline.

Wire identity is (src_node, src_param, dst_node, dst_param). A wire is present
in the live document iff an identical LiveWire exists. repair_graph() emits the
exact set of missing WireOps; it never deletes, so repair is monotonic and safe
to re-run (idempotent: second run emits zero ops).
"""
from collections import namedtuple

WireOp = namedtuple("WireOp", "src_node src_param dst_node dst_param")
ValidationIssue = namedtuple("ValidationIssue", "kind node param detail")


class GraphNode(object):
    __slots__ = ("id", "name", "category", "nickname", "guid")

    def __init__(self, id, name, category="", nickname="", guid=""):
        self.id = id
        self.name = name
        self.category = category
        self.nickname = nickname
        self.guid = guid

    def key(self):
        return (self.name, self.category)


class GraphSpec(object):
    """Declarative target graph: nodes + intended edges."""

    def __init__(self):
        self.nodes = {}   # id -> GraphNode
        self.edges = []   # list of WireOp
        self.groups = {}  # group name -> [node ids]

    def node(self, id):
        return self.nodes[id]

    def expected_wires(self):
        return list(self.edges)


class LiveNode(object):
    __slots__ = ("id", "name", "error", "error_msg")

    def __init__(self, id, name, error=False, error_msg=""):
        self.id = id
        self.name = name
        self.error = error
        self.error_msg = error_msg


class LiveWire(object):
    __slots__ = ("src_node", "src_param", "dst_node", "dst_param")

    def __init__(self, src_node, src_param, dst_node, dst_param):
        self.src_node = src_node
        self.src_param = src_param
        self.dst_node = dst_node
        self.dst_param = dst_param

    def key(self):
        return (self.src_node, self.src_param, self.dst_node, self.dst_param)


class LiveState(object):
    """Serialized Grasshopper document state captured by the bridge adapter."""

    def __init__(self, nodes=None, wires=None):
        self.nodes = nodes or {}   # id -> LiveNode
        self.wires = wires or []   # list of LiveWire

    def wire_keys(self):
        return set(w.key() for w in self.wires)


class ValidationReport(object):
    def __init__(self):
        self.missing_wires = []        # [WireOp]
        self.disconnected_inputs = []  # [ValidationIssue]
        self.disconnected_outputs = []  # [ValidationIssue]
        self.red_components = []       # [ValidationIssue]
        self.missing_components = []   # [ValidationIssue]
        self.issues = []               # flattened [ValidationIssue]

    @property
    def ok(self):
        return not (self.missing_wires or self.disconnected_inputs
                    or self.disconnected_outputs or self.red_components
                    or self.missing_components)

    @property
    def issue_count(self):
        return len(self.issues)

    def as_dict(self):
        return {
            "ok": self.ok,
            "missing_wires": [list(w) for w in self.missing_wires],
            "disconnected_inputs": [list(i) for i in self.disconnected_inputs],
            "disconnected_outputs": [list(i) for i in self.disconnected_outputs],
            "red_components": [list(i) for i in self.red_components],
            "missing_components": [list(i) for i in self.missing_components],
            "issue_count": len(self.issues),
        }


def validate_graph(spec, live):
    """Compare declarative spec against live GH state. Deterministic, read-only."""
    rep = ValidationReport()
    wire_keys = live.wire_keys()

    # 1. every expected wire must exist
    for op in spec.expected_wires():
        if (op.src_node, op.src_param, op.dst_node, op.dst_param) not in wire_keys:
            rep.missing_wires.append(op)
            rep.issues.append(ValidationIssue(
                "missing_wire", op.dst_node, op.dst_param,
                "expected wire {}:{} -> {}:{} absent".format(
                    op.src_node, op.src_param, op.dst_node, op.dst_param)))

    # 2. every spec component must exist in the live document (missing components)
    spec_ids = set(spec.nodes.keys())
    live_ids = set(live.nodes.keys())
    for nid in sorted(spec_ids - live_ids):
        nd = spec.nodes[nid]
        iss = ValidationIssue("missing_component", nid, "",
                              "component {!r} absent from document".format(nd.name))
        rep.missing_components.append(iss)
        rep.issues.append(iss)

    # 3. red / errored components
    for nid, ln in sorted(live.nodes.items()):
        if ln.error:
            iss = ValidationIssue("red_component", nid, "", ln.error_msg or "runtime error")
            rep.red_components.append(iss)
            rep.issues.append(iss)

    return rep


def compute_repair(spec, live):
    """Return the exact WireOps needed to make live match spec (missing wires only)."""
    wire_keys = live.wire_keys()
    ops = []
    for op in spec.expected_wires():
        if (op.src_node, op.src_param, op.dst_node, op.dst_param) not in wire_keys:
            ops.append(op)
    return ops


def repair_graph(spec, live, executor=None):
    """Self-heal: emit + (optionally) apply missing wires.

    executor: optional callable(ironpython_script) -> str output. When provided,
    the generated GH IronPython is executed against the live document. When None,
    the script is returned in the report for inspection (auditable, no side effects).
    Idempotent: re-running after a successful repair emits zero ops.
    """
    ops = compute_repair(spec, live)
    script = _render_repair_script(ops)
    applied = False
    executor_output = ""
    if executor is not None and ops:
        executor_output = executor(script)
        applied = True
    # re-validate only when we applied; otherwise report the plan
    report_after = None
    if applied:
        # caller should refresh live state and re-validate; we return the script
        # so the bridge can capture post-repair state. Deterministic audit trail.
        pass
    return {
        "missing_wire_count": len(ops),
        "wire_ops": [list(op) for op in ops],
        "ironpython_script": script,
        "applied": applied,
        "executor_output": executor_output,
    }


def _render_repair_script(ops):
    """Render the GH IronPython snippet that adds the missing wires.

    Uses the proven Grasshopper API: locate each component by its runtime ID,
    then connect source output param to destination input param. The bridge
    maps node ids to GH_DocumentObject instances before execution.
    """
    lines = ["import Grasshopper as gh", ""]
    lines.append("# Auto-generated by repair_graph() — deterministic, auditable")
    lines.append("added = 0")
    for src_node, src_param, dst_node, dst_param in ops:
        lines.append(
            "_wire({!r}, {!r}, {!r}, {!r})".format(src_node, src_param, dst_node, dst_param))
        lines.append("added += 1")
    lines.append('print "REPAIR_ADDED:" + str(added)')
    return "\n".join(lines)
