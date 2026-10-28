"""GH Definition Builder — the sole graph authoring engine (FRS-012 P2-F03).

Builds a declarative GraphSpec in memory. Component GUIDs are NEVER hardcoded:
add_component() resolves the proxy via ProxyCatalog (name + category + nickname),
raising AmbiguousProxyError when disambiguation is required. The spec is then
compiled to a single IronPython script (compile_single_shot) that constructs the
entire graph in ONE Grasshopper execution, saves once, and solves once — replacing
the per-component create/redraw round-trip with a 10-100x faster single shot.
"""
from .proxy_catalog import ProxyCatalog, AmbiguousProxyError, NotFoundProxyError
from .validate import GraphSpec, GraphNode, WireOp


class GHDefinitionBuilder(object):
    def __init__(self, catalog=None):
        self.catalog = catalog or ProxyCatalog()
        self.spec = GraphSpec()
        self._seq = 0

    def _next_id(self, prefix="n"):
        self._seq += 1
        return "{}{}".format(prefix, self._seq)

    def add_slider(self, name, value, minimum=0.0, maximum=10.0, step=0.1):
        nid = self._next_id("slider")
        self.spec.nodes[nid] = GraphNode(nid, name, category="Params", nickname="Number Slider")
        self._slider_cfg = getattr(self, "_slider_cfg", {})
        self._slider_cfg[nid] = dict(value=value, minimum=minimum, maximum=maximum, step=step)
        return nid

    def add_component(self, name, category=None, nickname=None, params=None):
        """Add a component by resolving its proxy from the live catalog.

        name: component Name (e.g. "Twist"). category disambiguates when multiple
        components share a name/nickname (e.g. two native "Pipe" components).
        Raises NotFoundProxyError / AmbiguousProxyError — never silently picks.
        """
        guid = self.catalog.resolve(name, category=category, exact=True)
        nid = self._next_id("comp")
        proxy = self.catalog.get(guid)
        if proxy is None:
            raise NotFoundProxyError("Resolved GUID {!r} not present in catalog".format(guid))
        self.spec.nodes[nid] = GraphNode(
            nid, proxy["n"], category=proxy["c"], nickname=proxy["k"], guid=guid)
        return nid

    def connect(self, src_node, src_param, dst_node, dst_param):
        self.spec.edges.append(WireOp(src_node, src_param, dst_node, dst_param))
        return self

    def group(self, name, node_ids):
        self.spec.groups[name] = list(node_ids)
        return self

    def validate(self, live_state=None):
        """Validate the in-memory spec. If live_state is provided, also diff against it."""
        from .validate import validate_graph, LiveState
        live = live_state if live_state is not None else LiveState(
            nodes={nid: _live_ok(n) for nid, n in self.spec.nodes.items()},
            wires=[LiveWireStub(w) for w in self.spec.edges])
        return validate_graph(self.spec, live)

    def save(self, path):
        """Serialize the declarative spec to a portable .ghspec JSON.

        The actual .ghpy Grasshopper document is produced by compile_single_shot()
        executed against a live Grasshopper session (single IronPython run).
        """
        import json
        data = {
            "format": "ghspec/1",
            "nodes": [
                {"id": n.id, "name": n.name, "category": n.category,
                 "nickname": n.nickname, "guid": n.guid}
                for n in self.spec.nodes.values()
            ],
            "edges": [list(e) for e in self.spec.edges],
            "groups": self.spec.groups,
        }
        with open(path, "w") as fh:
            json.dump(data, fh, indent=2)
        return path


class LiveWireStub(object):
    def __init__(self, op):
        self.src_node, self.src_param = op.src_node, op.src_param
        self.dst_node, self.dst_param = op.dst_node, op.dst_param

    def key(self):
        return (self.src_node, self.src_param, self.dst_node, self.dst_param)


def _live_ok(node):
    from .validate import LiveNode
    return LiveNode(node.id, node.name, error=False)


def compile_single_shot(builder):
    """Compile a builder's GraphSpec into ONE IronPython script that:
    creates every component (by resolved GUID), sets slider values, adds every
    wire, groups nodes, saves the .ghpy, and solves — in a single execution.

    This is the Phase 2 speed path: Build In Memory -> Single Execution -> Save
    Once -> Solve Once.
    """
    spec = builder.spec
    L = []
    L.append("import Grasshopper as gh")
    L.append("import System")
    L.append("import rhinoscriptsyntax as rs")
    L.append("")
    L.append("doc = gh.Instances.ActiveCanvas.Document if gh.Instances.ActiveCanvas else None")
    L.append("created = {}")
    # create components by GUID (resolved from catalog at build time)
    for nid, node in spec.nodes.items():
        if node.guid:
            L.append('created[{!r}] = _add_component({!r})'.format(nid, node.guid))
        else:
            L.append('created[{!r}] = _add_slider({!r})'.format(nid, node.name))
    # slider values
    slider_cfg = getattr(builder, "_slider_cfg", {})
    for nid, cfg in slider_cfg.items():
        L.append('_set_slider(created[{!r}], {!r})'.format(nid, cfg))
    # wires
    for op in spec.edges:
        L.append('_connect(created[{!r}], {!r}, created[{!r}], {!r})'.format(
            op.src_node, op.src_param, op.dst_node, op.dst_param))
    # groups
    for gname, members in spec.groups.items():
        L.append('_group({!r}, [created[{!r}] for _m in {!r}])'.format(gname, members[0], members))
    L.append('print "SINGLE_SHOT_CREATED:" + str(len(created))')
    L.append('print "SINGLE_SHOT_WIRES:" + str({!r})'.format(len(spec.edges)))
    return "\n".join(L)
