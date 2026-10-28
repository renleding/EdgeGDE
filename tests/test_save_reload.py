"""F12-F01.4 / F12-F05.2 save/reload verification (pure logic).

builder.save() emits a portable .ghspec JSON; reload must preserve nodes, edges,
groups exactly. (Full .ghpy round-trip is an integration concern.)"""
import json
import os
import tempfile

from gh_automation_core.builder import GHDefinitionBuilder


def test_save_reload_roundtrip():
    b = GHDefinitionBuilder()
    b.add_slider("Height", 300.0, 100.0, 500.0)
    b.add_component("Cylinder", category="Surface")
    b.connect("slider1", "Slider", "comp1", "Height")
    b.group("shell", ["slider1", "comp1"])

    path = os.path.join(tempfile.mkdtemp(), "lamp.ghspec")
    b.save(path)

    with open(path) as fh:
        d = json.load(fh)
    assert d["format"] == "ghspec/1"
    assert len(d["nodes"]) == 2
    assert len(d["edges"]) == 1
    assert d["edges"][0] == ["slider1", "Slider", "comp1", "Height"]
    assert d["groups"] == {"shell": ["slider1", "comp1"]}
    assert any(n["name"] == "Height" for n in d["nodes"])
