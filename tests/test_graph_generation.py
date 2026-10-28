"""F12-F05.1 deterministic generation tests (pure logic).

Building the same lamp 3 times MUST yield identical components, wires and groups.
Component GUIDs resolve from the live ProxyCatalog — never hardcoded in caller code.
"""
from gh_automation_core.builder import GHDefinitionBuilder


def _lamp():
    b = GHDefinitionBuilder()
    h = b.add_slider("Height", 300.0, 100.0, 500.0)
    d = b.add_slider("Diameter", 150.0, 80.0, 300.0)
    cyl = b.add_component("Cylinder", category="Surface")
    tw = b.add_component("Twist", category="Transform")
    b.connect(h, "Slider", cyl, "Height")
    b.connect(d, "Slider", cyl, "Radius")
    b.connect(cyl, "E", tw, "G")
    b.group("lamp", [h, d, cyl, tw])
    return b


def _sig(b):
    return (sorted(b.spec.nodes), [list(e) for e in b.spec.edges], dict(b.spec.groups))


def test_deterministic_generation_three_times():
    sigs = [_sig(_lamp()) for _ in range(3)]
    assert sigs[0] == sigs[1] == sigs[2]


def test_builder_resolves_guids_from_catalog():
    b = _lamp()
    guids = [n.guid for n in b.spec.nodes.values() if n.guid]
    assert guids, "no resolved GUIDs — components must come from the catalog"
    for g in guids:
        assert len(g) == 36  # catalog-resolved UUID, not a caller literal
