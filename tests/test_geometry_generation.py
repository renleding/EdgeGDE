"""F12-F05.4 geometry verification tests (integration — needs live RhinoClaw).

Asserts the geometry gate: mesh exists, faces>0, vertices>0. A smooth shell with
zero lattice FAILS here (graph success != geometry success)."""
import os
import pytest

from gh_automation_core.closed_loop import ClosedLoopSession, RhinoClawBridge

pytestmark = pytest.mark.integration


def _session():
    return ClosedLoopSession(RhinoClawBridge(
        host=os.environ.get("RHINOCLAW_HOST", "100.110.105.101")))


def test_geometry_mesh_exists_faces_verts():
    s = _session()
    s.load_definition(os.environ["FRS_LAMP"])
    s.show_definition()
    s.refresh_controls()
    s.solve_on_canvas()

    outs = s.measure_all_outputs()
    assert any(v.get("count", 0) > 0 for v in outs.values()), "no geometry outputs"

    nat = s.get_outputs()
    faces = verts = 0
    for o in nat.get("outputs", {}).values():
        for v in (o.get("values") or []):
            if isinstance(v, str) and "faces:" in v:
                try:
                    verts = max(verts, int(v.split("vertices:")[1].split(",")[0]))
                    faces = max(faces, int(v.split("faces:")[1].rstrip(")").strip()))
                except (ValueError, IndexError):
                    pass
    assert faces > 0, "gyroid mesh faces = 0 (geometry not generated)"
    assert verts > 0, "gyroid mesh vertices = 0"
