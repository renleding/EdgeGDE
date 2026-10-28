"""F12-F04 inspection tests.

Pure-logic leg (inspect._parse) runs offline; the live inspect_workspace leg is
integration-marked and requires a RhinoClaw host."""
import os
import pytest

from gh_automation_core.inspect import _parse


def test_parse_inspect_script_output():
    raw = ("GH_COMPONENTS:5\nGH_RED:1\nGH_RED_NAMES:Twist\nGH_WIRES:4\n"
           "RHINO_OBJECTS:88\nRHINO_MESHES:10\nRHINO_BREPS:28\n"
           "RHINO_MESH_FACES:803560\nRHINO_MESH_VERTS:2406918\n")
    r = _parse(raw)
    assert r["grasshopper"]["components"] == 5
    assert r["grasshopper"]["red"] == 1
    assert r["grasshopper"]["red_names"] == ["Twist"]
    assert r["grasshopper"]["wires"] == 4
    assert r["rhino"]["objects"] == 88
    assert r["rhino"]["mesh_faces"] == 803560
    assert r["rhino"]["mesh_verts"] == 2406918


@pytest.mark.integration
def test_inspect_workspace_live():
    from gh_automation_core.closed_loop import ClosedLoopSession, RhinoClawBridge
    s = ClosedLoopSession(RhinoClawBridge(
        host=os.environ.get("RHINOCLAW_HOST", "100.110.105.101")))
    s.load_definition(os.environ["FRS_LAMP"])
    s.show_definition()
    s.refresh_controls()
    insp = s.inspect_workspace(
        ["gyroid_lattice", "parametric_controls", "mounting_collar", "printable_mesh"])
    assert insp["slider_count"] >= 5
    assert "feature_compliance" in insp
    assert "viewport" in insp and insp["viewport"]["sha256"]
